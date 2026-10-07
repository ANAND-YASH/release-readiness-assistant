// Read models for AI analysis results.

import type { Citation } from "@/lib/ai/types";
import { getDb } from "@/lib/db";
import { diffVersions } from "@/lib/domain/diff-versions";
import type { ItemHashes } from "@/lib/domain/hash";
import { computeStaleness, type StaleResult } from "@/lib/domain/staleness";
import { ReleasePackageSchema, type ReleasePackage } from "@/lib/schema/release-package";
import type {
  AnalysisRunStatus,
  GeneratedStatement,
  ReviewStatus,
  StatementKind,
  StatementSource,
} from "@/lib/generated/prisma/client";

export interface AnalysisRunDto {
  id: string;
  status: AnalysisRunStatus;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  latencyMs: number | null;
  attempts: number;
  promptTokens: number | null;
  completionTokens: number | null;
  error: string | null;
  createdAt: string;
}

export interface StatementDto {
  id: string;
  kind: StatementKind;
  source: StatementSource;
  level: string | null;
  /** Reviewer-facing text: the edited content if any, else the generated content. */
  content: string;
  aiContent: string;
  editedContent: string | null;
  metadata: Record<string, unknown> | null;
  citations: Citation[];
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  order: number;
}

export interface VersionAnalysis {
  /** Most recent run of any status (drives running/failed UI). */
  latestRun: AnalysisRunDto | null;
  /** Most recent successful run, whose statements are shown. */
  statementsRun: AnalysisRunDto | null;
  statements: StatementDto[];
}

type RunRow = Awaited<ReturnType<ReturnType<typeof getDb>["analysisRun"]["findFirst"]>> & object;

function toRunDto(row: RunRow): AnalysisRunDto {
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    latencyMs: row.latencyMs,
    attempts: row.attempts,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getVersionAnalysis(versionId: string): Promise<VersionAnalysis> {
  const db = getDb();
  const [latest, succeeded] = await Promise.all([
    db.analysisRun.findFirst({ where: { versionId }, orderBy: { createdAt: "desc" } }),
    db.analysisRun.findFirst({
      where: { versionId, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      include: { statements: { orderBy: { order: "asc" } } },
    }),
  ]);

  return {
    latestRun: latest ? toRunDto(latest) : null,
    statementsRun: succeeded ? toRunDto(succeeded) : null,
    statements: (succeeded?.statements ?? []).map(toStatementDto),
  };
}

export function toStatementDto(s: GeneratedStatement): StatementDto {
  return {
    id: s.id,
    kind: s.kind,
    source: s.source,
    level: s.level,
    content: s.editedContent ?? s.aiContent,
    aiContent: s.aiContent,
    editedContent: s.editedContent,
    metadata: (s.metadata as Record<string, unknown> | null) ?? null,
    citations: s.citations as unknown as Citation[],
    reviewStatus: s.reviewStatus,
    reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    reviewNote: s.reviewNote,
    order: s.order,
  };
}

export interface ReviewStatementDto extends StatementDto {
  stale: StaleResult;
}

interface VersionSnapshot {
  versionNumber: number;
  package: ReleasePackage;
  itemHashes: ItemHashes;
}

/** Staleness of statements generated from `from`, evaluated against `to`. Never mutates the statements. */
export function assessStaleness(statements: StatementDto[], from: VersionSnapshot, to: VersionSnapshot): ReviewStatementDto[] {
  if (from.versionNumber === to.versionNumber) {
    return statements.map((s) => ({ ...s, stale: { stale: false, reasons: [] } }));
  }
  const diff = diffVersions(from, to);
  return statements.map((s) => ({
    ...s,
    stale: computeStaleness(
      { kind: s.kind, content: s.content, citations: s.citations, metadata: s.metadata },
      { from: from.package, to, diff },
    ),
  }));
}

export interface ReviewData {
  /** Most recent run of any status for the viewed version (drives running/failed UI). */
  latestRun: AnalysisRunDto | null;
  /** Run whose statements are shown: the viewed version's own, or carried over from an earlier version. */
  statementsRun: (AnalysisRunDto & { versionNumber: number }) | null;
  /** Version the shown statements were generated for, when it differs from the viewed version. */
  carriedFrom: number | null;
  /** Staleness is evaluated against the release's current (latest) version. */
  currentVersionNumber: number;
  statements: ReviewStatementDto[];
}

export function toVersionSnapshot(row: { versionNumber: number; package: unknown; itemHashes: unknown }): VersionSnapshot {
  return {
    versionNumber: row.versionNumber,
    package: ReleasePackageSchema.parse(row.package),
    itemHashes: row.itemHashes as ItemHashes,
  };
}

/**
 * Statements to review for a version: those of its latest successful run or, if it
 * has none, those of the most recent successful run of an earlier version. Every
 * statement is checked for staleness against the release's current version.
 */
export async function getReviewData(releaseId: string, versionNumber: number): Promise<ReviewData | null> {
  const db = getDb();
  const [viewed, current] = await Promise.all([
    db.releaseVersion.findUnique({ where: { releaseId_versionNumber: { releaseId, versionNumber } } }),
    db.releaseVersion.findFirst({ where: { releaseId }, orderBy: { versionNumber: "desc" } }),
  ]);
  if (!viewed || !current) return null;

  const [latest, run] = await Promise.all([
    db.analysisRun.findFirst({ where: { versionId: viewed.id }, orderBy: { createdAt: "desc" } }),
    db.analysisRun.findFirst({
      where: { status: "SUCCEEDED", version: { releaseId, versionNumber: { lte: versionNumber } } },
      orderBy: [{ version: { versionNumber: "desc" } }, { createdAt: "desc" }],
      include: { statements: { orderBy: { order: "asc" } }, version: true },
    }),
  ]);

  const statements = run
    ? assessStaleness(run.statements.map(toStatementDto), toVersionSnapshot(run.version), toVersionSnapshot(current))
    : [];
  return {
    latestRun: latest ? toRunDto(latest) : null,
    statementsRun: run ? { ...toRunDto(run), versionNumber: run.version.versionNumber } : null,
    carriedFrom: run && run.version.versionNumber !== versionNumber ? run.version.versionNumber : null,
    currentVersionNumber: current.versionNumber,
    statements,
  };
}
