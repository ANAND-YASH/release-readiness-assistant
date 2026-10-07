// AI analysis workflow for one release version:
//
//   version → deterministic pre-check (blocks invalid packages)
//           → analysis call  → parse + Zod → retry once on failure
//           → citation checks (drop anything not grounded in this version)
//           → summaries call → parse + Zod → retry once on failure → citation + claim checks
//           → persist statements as PENDING and the AnalysisRun, in one transaction
//
// This module never touches Release.status: approving a release is a human action.

import type { z } from "zod";
import { recordEvent } from "@/lib/app-log";
import { getDb } from "@/lib/db";
import { sha256, stableStringify, type ItemHashes } from "@/lib/domain/hash";
import { ApiError } from "@/lib/errors";
import type { Prisma, StatementKind } from "@/lib/generated/prisma/client";
import { ReleasePackageSchema } from "@/lib/schema/release-package";
import type { ServiceContext } from "@/lib/services/releases";
import { getAIProvider } from "./factory";
import { buildAnalysisInput, buildSummariesInput } from "./input";
import { AnalysisOutputSchema, SummariesOutputSchema } from "./output-schema";
import { runPrecheck } from "./precheck";
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserPrompt } from "./prompts/analysis.v1";
import { SUMMARIES_PROMPT_VERSION, SUMMARIES_SYSTEM_PROMPT, buildSummariesUserPrompt } from "./prompts/summaries.v1";
import { AiProviderError, type AIProvider, type AiRequest } from "./provider";
import { indexItems, sanitizeAnalysis, sanitizeSummaries } from "./sanitize";
import type { Citation, DraftStatement, DroppedOutput } from "./types";

export const PROMPT_VERSION = `${ANALYSIS_PROMPT_VERSION}+${SUMMARIES_PROMPT_VERSION}`;
export const MAX_ATTEMPTS_PER_CALL = 2;

const KIND_ORDER: StatementKind[] = [
  "IMPACT",
  "MISSING_INFO",
  "UNSUPPORTED_CLAIM",
  "RISK",
  "TECH_SUMMARY",
  "NONTECH_SUMMARY",
];

interface AttemptRecord {
  task: string;
  attempt: number;
  outcome: "valid" | "invalid" | "provider_error";
  latencyMs: number;
  error?: string;
  rawText?: string;
  promptTokens?: number;
  completionTokens?: number;
}

type CallResult<T> = { ok: true; output: T } | { ok: false; error: string };

export interface AnalysisContext extends ServiceContext {
  /** Injected in tests; defaults to the provider selected by AI_PROVIDER. */
  provider?: AIProvider;
}

function summarizeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** One structured call with exactly one retry when the output is unparseable or fails the schema. */
async function callStructured<T>(
  provider: AIProvider,
  request: Omit<AiRequest, "retry">,
  schema: z.ZodType<T>,
  attempts: AttemptRecord[],
  ctx: AnalysisContext,
  logBase: { releaseId: string; runId: string },
): Promise<CallResult<T>> {
  const task = request.task.name;
  let retry: AiRequest["retry"];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CALL; attempt++) {
    const started = performance.now();
    let rawText: string;
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    try {
      const response = await provider.generate({ ...request, retry });
      rawText = response.rawText;
      usage = response.usage;
    } catch (err) {
      const error = err instanceof AiProviderError ? err.message : "AI provider call failed";
      const latencyMs = Math.round(performance.now() - started);
      attempts.push({ task, attempt, outcome: "provider_error", latencyMs, error });
      // Full error (with cause) to stdout only; the persisted event carries the sanitized message.
      ctx.log.error("analysis.provider_error", { ...logBase, task, attempt, error: err });
      await recordEvent(ctx.log, {
        level: "error",
        event: "analysis.llm_attempt",
        requestId: ctx.requestId,
        releaseId: logBase.releaseId,
        context: { runId: logBase.runId, task, attempt, outcome: "provider_error", latencyMs, error },
      });
      return { ok: false, error: `${task}: ${error}` };
    }

    let error: string | undefined;
    let output: T | undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(rawText));
      if (parsed.success) output = parsed.data;
      else error = `Output does not match the schema: ${summarizeZodError(parsed.error)}`;
    } catch (err) {
      error = `Output is not valid JSON: ${(err as Error).message}`;
    }

    const latencyMs = Math.round(performance.now() - started);
    attempts.push({
      task,
      attempt,
      outcome: error ? "invalid" : "valid",
      latencyMs,
      rawText,
      ...(error ? { error } : {}),
      ...(usage ?? {}),
    });
    await recordEvent(ctx.log, {
      level: error ? "warn" : "info",
      event: "analysis.llm_attempt",
      requestId: ctx.requestId,
      releaseId: logBase.releaseId,
      context: { runId: logBase.runId, task, attempt, outcome: error ? "invalid" : "valid", latencyMs, ...(usage ?? {}) },
    });

    if (!error) {
      await recordEvent(ctx.log, {
        level: "info",
        event: "analysis.output_validated",
        requestId: ctx.requestId,
        releaseId: logBase.releaseId,
        context: { runId: logBase.runId, task, attempt },
      });
      return { ok: true, output: output as T };
    }
    if (attempt < MAX_ATTEMPTS_PER_CALL) {
      await recordEvent(ctx.log, {
        level: "warn",
        event: "analysis.retry",
        requestId: ctx.requestId,
        releaseId: logBase.releaseId,
        context: { runId: logBase.runId, task, error: error.slice(0, 500) },
      });
      retry = { previousOutput: rawText.slice(0, 20_000), error };
    } else {
      return { ok: false, error: `${task}: ${error}` };
    }
  }
  return { ok: false, error: `${task}: no attempts made` };
}

function orderStatements(drafts: DraftStatement[]): DraftStatement[] {
  return KIND_ORDER.flatMap((kind) => [
    ...drafts.filter((d) => d.kind === kind && d.source === "RULE"),
    ...drafts.filter((d) => d.kind === kind && d.source === "AI"),
  ]);
}

function toCitations(ids: string[], itemHashes: ItemHashes): Citation[] {
  // Every ID was already checked against this version; the filter is a last guard.
  return ids.filter((id) => itemHashes[id]).map((itemId) => ({ itemId, itemHash: itemHashes[itemId] }));
}

function tally<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
}

export interface AnalysisOutcome {
  runId: string;
  statementCount: number;
  droppedCount: number;
}

export async function runAnalysis(
  releaseId: string,
  versionNumber: number,
  ctx: AnalysisContext,
): Promise<AnalysisOutcome> {
  const db = getDb();
  const version = await db.releaseVersion.findUnique({
    where: { releaseId_versionNumber: { releaseId, versionNumber } },
    include: { release: { select: { name: true, product: true } } },
  });
  if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");

  const pkg = ReleasePackageSchema.parse(version.package);
  const itemHashes = version.itemHashes as ItemHashes;
  const precheck = runPrecheck(pkg);

  if (!precheck.validation.valid) {
    await recordEvent(ctx.log, {
      level: "warn",
      event: "analysis.precheck_failed",
      requestId: ctx.requestId,
      releaseId,
      context: { versionNumber, errorCodes: precheck.validation.errors.map((e) => e.code) },
    });
    throw new ApiError(
      422,
      "ANALYSIS_BLOCKED",
      `Analysis is blocked: the package has ${precheck.validation.errors.length} blocking validation error(s).`,
      precheck.validation,
    );
  }

  const provider = ctx.provider ?? getAIProvider();
  const input = buildAnalysisInput(version.release, versionNumber, pkg, precheck);
  const inputHash = sha256(stableStringify({ promptVersion: PROMPT_VERSION, provider: provider.name, model: provider.model, input }));

  const run = await db.analysisRun.create({
    data: {
      versionId: version.id,
      provider: provider.name,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      inputHash,
      precheck: {
        coverage: precheck.coverage,
        claimCandidates: precheck.claimCandidates,
        ruleStatementCount: precheck.ruleStatements.length,
      } as unknown as Prisma.InputJsonObject,
    },
  });
  const logBase = { releaseId, runId: run.id };
  await recordEvent(ctx.log, {
    level: "info",
    event: "analysis.started",
    requestId: ctx.requestId,
    releaseId,
    context: { runId: run.id, versionNumber, provider: provider.name, model: provider.model, promptVersion: PROMPT_VERSION },
  });

  const started = performance.now();
  const attempts: AttemptRecord[] = [];
  const tokens = () => ({
    promptTokens: attempts.some((a) => a.promptTokens !== undefined)
      ? attempts.reduce((sum, a) => sum + (a.promptTokens ?? 0), 0)
      : null,
    completionTokens: attempts.some((a) => a.completionTokens !== undefined)
      ? attempts.reduce((sum, a) => sum + (a.completionTokens ?? 0), 0)
      : null,
  });

  const fail = async (error: string): Promise<never> => {
    const latencyMs = Math.round(performance.now() - started);
    await db.analysisRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error,
        attempts: attempts.length,
        latencyMs,
        ...tokens(),
        rawOutput: { attempts } as unknown as Prisma.InputJsonObject,
      },
    });
    await recordEvent(ctx.log, {
      level: "error",
      event: "analysis.failed",
      requestId: ctx.requestId,
      releaseId,
      context: { runId: run.id, versionNumber, attempts: attempts.length, latencyMs, error: error.slice(0, 500) },
    });
    throw new ApiError(502, "ANALYSIS_FAILED", `AI analysis failed: ${error.slice(0, 300)}`, { runId: run.id });
  };

  try {
    const analysis = await callStructured(
      provider,
      {
        task: { name: "analysis", input },
        system: ANALYSIS_SYSTEM_PROMPT,
        user: buildAnalysisUserPrompt(input),
        schemaName: "release_analysis",
        schema: AnalysisOutputSchema,
      },
      AnalysisOutputSchema,
      attempts,
      ctx,
      logBase,
    );
    if (!analysis.ok) return await fail(analysis.error);

    const index = indexItems(pkg);
    const analysed = sanitizeAnalysis(analysis.output, index, precheck.ruleStatements);
    const summariesInput = buildSummariesInput(input, [...precheck.ruleStatements, ...analysed.statements]);

    const summaries = await callStructured(
      provider,
      {
        task: { name: "summaries", input: summariesInput },
        system: SUMMARIES_SYSTEM_PROMPT,
        user: buildSummariesUserPrompt(summariesInput),
        schemaName: "release_summaries",
        schema: SummariesOutputSchema,
      },
      SummariesOutputSchema,
      attempts,
      ctx,
      logBase,
    );
    if (!summaries.ok) return await fail(summaries.error);

    const summarized = sanitizeSummaries(summaries.output, index);
    const dropped: DroppedOutput[] = [...analysed.dropped, ...summarized.dropped];
    if (dropped.length > 0) {
      await recordEvent(ctx.log, {
        level: "warn",
        event: "analysis.invalid_citations_dropped",
        requestId: ctx.requestId,
        releaseId,
        context: {
          runId: run.id,
          count: dropped.length,
          byReason: tally(dropped.map((d) => d.reason)),
          invalidIds: [
            ...new Set(
              dropped
                .filter((d) => d.reason === "unknown_item" || d.reason === "invalid_citation")
                .flatMap((d) => d.ids ?? []),
            ),
          ].slice(0, 50),
        },
      });
    }

    const drafts = orderStatements([...precheck.ruleStatements, ...analysed.statements, ...summarized.statements]);
    const latencyMs = Math.round(performance.now() - started);

    await db.$transaction([
      db.generatedStatement.createMany({
        data: drafts.map((draft, order) => ({
          runId: run.id,
          versionId: version.id,
          kind: draft.kind,
          source: draft.source,
          level: draft.level,
          aiContent: draft.content,
          metadata: (draft.metadata ?? undefined) as Prisma.InputJsonObject | undefined,
          citations: toCitations(draft.citations, itemHashes) as unknown as Prisma.InputJsonArray,
          reviewStatus: "PENDING",
          order,
        })),
      }),
      db.analysisRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          attempts: attempts.length,
          latencyMs,
          ...tokens(),
          rawOutput: { attempts, dropped } as unknown as Prisma.InputJsonObject,
        },
      }),
    ]);

    await recordEvent(ctx.log, {
      level: "info",
      event: "analysis.completed",
      requestId: ctx.requestId,
      releaseId,
      context: {
        runId: run.id,
        versionNumber,
        latencyMs,
        attempts: attempts.length,
        statements: tally(drafts.map((d) => d.kind)),
        ruleStatements: precheck.ruleStatements.length,
        dropped: dropped.length,
        ...tokens(),
      },
    });
    return { runId: run.id, statementCount: drafts.length, droppedCount: dropped.length };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Unexpected failure (e.g. database): don't leave the run RUNNING.
    await db.analysisRun
      .update({ where: { id: run.id }, data: { status: "FAILED", error: "Internal error during analysis", attempts: attempts.length } })
      .catch(() => undefined);
    throw err;
  }
}
