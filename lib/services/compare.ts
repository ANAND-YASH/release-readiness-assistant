// Version comparison read model: item and section diff between two versions of a
// release, plus the statements of the `from` version's analysis that are stale in `to`.

import { getDb } from "@/lib/db";
import { diffVersions, type ItemDiff, type ScalarDiff, type VersionDiff } from "@/lib/domain/diff-versions";
import type { ItemHashes } from "@/lib/domain/hash";
import { ApiError } from "@/lib/errors";
import { ReleasePackageSchema } from "@/lib/schema/release-package";
import { assessStaleness, toStatementDto, type ReviewStatementDto } from "@/lib/services/analysis";

export interface ComparedVersion {
  versionNumber: number;
  changeNote: string | null;
  createdAt: string;
  packageHash: string;
}

export interface Comparison {
  release: { id: string; name: string };
  fromVersion: ComparedVersion;
  toVersion: ComparedVersion;
  added: ItemDiff[];
  removed: ItemDiff[];
  modified: ItemDiff[];
  unchanged: ItemDiff[];
  scalarChanges: ScalarDiff[];
  changedSections: VersionDiff["changedSections"];
  counts: VersionDiff["counts"];
  /** Latest successful analysis of the `from` version, if any. */
  fromAnalysis: { runId: string; statementCount: number } | null;
  staleStatements: ReviewStatementDto[];
  freshStatementCount: number;
}

export async function compareVersions(releaseId: string, from: number, to: number): Promise<Comparison> {
  if (from === to) {
    throw new ApiError(400, "VALIDATION_ERROR", "Choose two different versions to compare.", [
      { path: "to", message: "from and to must be different versions" },
    ]);
  }
  const db = getDb();
  const release = await db.release.findUnique({ where: { id: releaseId }, select: { id: true, name: true } });
  if (!release) throw new ApiError(404, "NOT_FOUND", "Release not found");

  // Versions are addressed by number within this release, so a version of another release can't be compared.
  const [fromRow, toRow] = await Promise.all(
    [from, to].map((versionNumber) =>
      db.releaseVersion.findUnique({ where: { releaseId_versionNumber: { releaseId, versionNumber } } }),
    ),
  );
  const missing = [fromRow ? null : from, toRow ? null : to].filter((v) => v !== null);
  if (!fromRow || !toRow) {
    throw new ApiError(404, "NOT_FOUND", `Version ${missing.join(" and ")} not found for this release`);
  }

  const snap = (row: NonNullable<typeof fromRow>) => ({
    versionNumber: row.versionNumber,
    package: ReleasePackageSchema.parse(row.package),
    itemHashes: row.itemHashes as ItemHashes,
  });
  const fromSnap = snap(fromRow);
  const toSnap = snap(toRow);
  const diff = diffVersions(fromSnap, toSnap);

  const run = await db.analysisRun.findFirst({
    where: { versionId: fromRow.id, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    include: { statements: { orderBy: { order: "asc" } } },
  });
  const assessed = run ? assessStaleness(run.statements.map(toStatementDto), fromSnap, toSnap) : [];

  const meta = (row: NonNullable<typeof fromRow>): ComparedVersion => ({
    versionNumber: row.versionNumber,
    changeNote: row.changeNote,
    createdAt: row.createdAt.toISOString(),
    packageHash: row.packageHash,
  });
  const byChange = (change: ItemDiff["change"]) => diff.items.filter((i) => i.change === change);

  return {
    release,
    fromVersion: meta(fromRow),
    toVersion: meta(toRow),
    added: byChange("added"),
    removed: byChange("removed"),
    modified: byChange("modified"),
    unchanged: byChange("unchanged"),
    scalarChanges: diff.scalars,
    changedSections: diff.changedSections,
    counts: diff.counts,
    fromAnalysis: run ? { runId: run.id, statementCount: run.statements.length } : null,
    staleStatements: assessed.filter((s) => s.stale.stale),
    freshStatementCount: assessed.filter((s) => !s.stale.stale).length,
  };
}
