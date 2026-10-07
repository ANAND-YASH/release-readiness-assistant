// Release and version persistence. Used by API routes and server-rendered pages.
//
// Versions are immutable: this module only ever inserts ReleaseVersion rows, and a
// database trigger rejects UPDATEs (see prisma/migrations/*_release_version_immutable).

import { recordEvent } from "@/lib/app-log";
import { getDb } from "@/lib/db";
import { computeItemHashes, hashPackage, type ItemHashes } from "@/lib/domain/hash";
import { findReusedIds, maxItemNumbers, type ItemCounters } from "@/lib/domain/item-ids";
import { validatePackage, type ValidationResult } from "@/lib/domain/validate-package";
import { ApiError } from "@/lib/errors";
import type { Prisma, ReleaseStatus } from "@/lib/generated/prisma/client";
import type { Logger } from "@/lib/log";
import { SAMPLE_RELEASE, SAMPLE_V1, SAMPLE_V2, SAMPLE_V2_CHANGE_NOTE } from "@/lib/sample-data";
import { ReleasePackageSchema, type ReleasePackage } from "@/lib/schema/release-package";
import type { CreateReleaseBody, CreateVersionBody } from "@/lib/schema/release-requests";

// --- DTOs --------------------------------------------------------------------

export interface VersionSummary {
  versionNumber: number;
  changeNote: string | null;
  createdAt: string;
  packageHash: string;
  itemCount: number;
  errorCount: number;
  warningCount: number;
}

export interface VersionDetail extends Omit<VersionSummary, "errorCount" | "warningCount"> {
  id: string;
  releaseId: string;
  package: ReleasePackage;
  itemHashes: ItemHashes;
  validation: ValidationResult;
}

export interface ReleaseSummary {
  id: string;
  name: string;
  product: string;
  status: ReleaseStatus;
  /** YYYY-MM-DD */
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersion: VersionSummary | null;
  /** Human release decision (set only by the decision service). */
  decision: {
    decidedBy: string;
    decidedAt: string;
    note: string | null;
    versionNumber: number | null;
  } | null;
}

export interface ReleaseDetail extends ReleaseSummary {
  /** Newest first. */
  versions: VersionSummary[];
}

export interface ServiceContext {
  log: Logger;
  requestId?: string;
}

// --- Mapping -----------------------------------------------------------------

const versionSummarySelect = {
  versionNumber: true,
  changeNote: true,
  createdAt: true,
  packageHash: true,
  itemHashes: true,
  validation: true,
} satisfies Prisma.ReleaseVersionSelect;

type VersionSummaryRow = Prisma.ReleaseVersionGetPayload<{ select: typeof versionSummarySelect }>;

function toVersionSummary(row: VersionSummaryRow): VersionSummary {
  const validation = row.validation as unknown as ValidationResult;
  return {
    versionNumber: row.versionNumber,
    changeNote: row.changeNote,
    createdAt: row.createdAt.toISOString(),
    packageHash: row.packageHash,
    itemCount: Object.keys(row.itemHashes as ItemHashes).length,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
  };
}

type ReleaseRow = Prisma.ReleaseGetPayload<{ include: { versions: { select: typeof versionSummarySelect } } }>;

function toReleaseSummary(row: ReleaseRow): ReleaseSummary {
  const versions = [...row.versions].sort((a, b) => b.versionNumber - a.versionNumber);
  return {
    id: row.id,
    name: row.name,
    product: row.product,
    status: row.status,
    targetDate: row.targetDate ? row.targetDate.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestVersion: versions[0] ? toVersionSummary(versions[0]) : null,
    decision:
      row.decidedBy && row.decidedAt
        ? {
            decidedBy: row.decidedBy,
            decidedAt: row.decidedAt.toISOString(),
            note: row.decisionNote,
            versionNumber: row.decidedVersionNumber,
          }
        : null,
  };
}

function toVersionDetail(row: Prisma.ReleaseVersionGetPayload<object>): VersionDetail {
  return {
    id: row.id,
    releaseId: row.releaseId,
    versionNumber: row.versionNumber,
    changeNote: row.changeNote,
    createdAt: row.createdAt.toISOString(),
    packageHash: row.packageHash,
    itemCount: Object.keys(row.itemHashes as ItemHashes).length,
    package: ReleasePackageSchema.parse(row.package),
    itemHashes: row.itemHashes as ItemHashes,
    validation: row.validation as unknown as ValidationResult,
  };
}

// --- Snapshots ---------------------------------------------------------------

function packageInvalid(validation: ValidationResult): ApiError {
  return new ApiError(
    422,
    "PACKAGE_INVALID",
    `The release package has ${validation.errors.length} blocking validation error(s).`,
    validation,
  );
}

/** Validate and build the immutable snapshot columns. Throws 422 on blocking errors. */
function buildSnapshot(pkg: ReleasePackage) {
  const validation = validatePackage(pkg);
  if (!validation.valid) throw packageInvalid(validation);
  const itemHashes = computeItemHashes(pkg);
  return {
    package: pkg as unknown as Prisma.InputJsonObject,
    itemHashes,
    packageHash: hashPackage(pkg),
    validation: validation as unknown as Prisma.InputJsonObject,
    summary: { itemCount: Object.keys(itemHashes).length, warningCount: validation.warnings.length },
  };
}

// --- Queries -----------------------------------------------------------------

export async function listReleases(): Promise<ReleaseSummary[]> {
  const rows = await getDb().release.findMany({
    orderBy: { createdAt: "desc" },
    include: { versions: { select: versionSummarySelect, orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  return rows.map(toReleaseSummary);
}

export async function getRelease(releaseId: string): Promise<ReleaseDetail | null> {
  const row = await getDb().release.findUnique({
    where: { id: releaseId },
    include: { versions: { select: versionSummarySelect, orderBy: { versionNumber: "desc" } } },
  });
  if (!row) return null;
  return { ...toReleaseSummary(row), versions: row.versions.map(toVersionSummary) };
}

export async function getVersion(releaseId: string, versionNumber: number): Promise<VersionDetail | null> {
  const row = await getDb().releaseVersion.findUnique({
    where: { releaseId_versionNumber: { releaseId, versionNumber } },
  });
  return row ? toVersionDetail(row) : null;
}

export async function getLatestVersion(releaseId: string): Promise<VersionDetail | null> {
  const row = await getDb().releaseVersion.findFirst({
    where: { releaseId },
    orderBy: { versionNumber: "desc" },
  });
  return row ? toVersionDetail(row) : null;
}

/** Highest item number per section across all versions, so new items never reuse an ID. */
export async function getItemCounters(releaseId: string): Promise<ItemCounters> {
  const rows = await getDb().releaseVersion.findMany({ where: { releaseId }, select: { package: true } });
  return maxItemNumbers(rows.map((row) => ReleasePackageSchema.parse(row.package)));
}

// --- Commands ----------------------------------------------------------------

export async function createRelease(
  input: CreateReleaseBody,
  ctx: ServiceContext,
): Promise<{ release: ReleaseSummary; version: VersionDetail }> {
  const { summary, ...snapshot } = buildSnapshot(input.package);

  const row = await getDb().release.create({
    data: {
      name: input.name,
      product: input.product,
      targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00Z`) : null,
      versions: { create: { versionNumber: 1, changeNote: "Initial version", ...snapshot } },
    },
    include: { versions: true },
  });

  await recordEvent(ctx.log, {
    level: "info",
    event: "release.created",
    requestId: ctx.requestId,
    releaseId: row.id,
    context: { versionNumber: 1, ...summary },
  });

  return { release: toReleaseSummary(row), version: toVersionDetail(row.versions[0]) };
}

export async function createVersion(
  releaseId: string,
  input: CreateVersionBody,
  ctx: ServiceContext,
): Promise<VersionDetail> {
  const { summary, ...snapshot } = buildSnapshot(input.package);

  const row = await getDb().$transaction(async (tx) => {
    const history = await tx.releaseVersion.findMany({
      where: { releaseId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true, packageHash: true, package: true },
    });
    if (history.length === 0) throw new ApiError(404, "NOT_FOUND", "Release not found");

    const latest = history[0];
    if (input.baseVersionNumber !== latest.versionNumber) {
      throw new ApiError(
        409,
        "CONFLICT",
        `Version ${latest.versionNumber} was saved after you started editing version ${input.baseVersionNumber}. Reload to edit the latest version.`,
        { latestVersionNumber: latest.versionNumber },
      );
    }
    if (snapshot.packageHash === latest.packageHash) {
      throw new ApiError(422, "NO_CHANGES", `The package is identical to version ${latest.versionNumber}.`);
    }

    const packages = history.map((v) => ReleasePackageSchema.parse(v.package));
    const reused = findReusedIds(input.package, packages[0], packages.slice(1));
    if (reused.length > 0) {
      const validation = snapshot.validation as unknown as ValidationResult;
      throw packageInvalid({
        valid: false,
        errors: reused.map((id) => ({
          code: "ITEM_ID_REUSED",
          severity: "error",
          path: id,
          itemId: id,
          message: `${id} belonged to a deleted item in an earlier version; new items need a new ID.`,
        })),
        warnings: validation.warnings,
      });
    }

    // A concurrent insert of the same number fails on @@unique and maps to 409.
    return tx.releaseVersion.create({
      data: { releaseId, versionNumber: latest.versionNumber + 1, changeNote: input.changeNote, ...snapshot },
    });
  });

  await recordEvent(ctx.log, {
    level: "info",
    event: "release.version.created",
    requestId: ctx.requestId,
    releaseId,
    context: { versionNumber: row.versionNumber, baseVersionNumber: input.baseVersionNumber, ...summary },
  });

  return toVersionDetail(row);
}

/** Creates the demo release with two versions through the normal code paths. */
export async function createSampleRelease(ctx: ServiceContext): Promise<ReleaseSummary> {
  const { release } = await createRelease(
    { ...SAMPLE_RELEASE, package: ReleasePackageSchema.parse(SAMPLE_V1) },
    ctx,
  );
  await createVersion(
    release.id,
    { package: ReleasePackageSchema.parse(SAMPLE_V2), changeNote: SAMPLE_V2_CHANGE_NOTE, baseVersionNumber: 1 },
    ctx,
  );
  return (await getRelease(release.id))!;
}
