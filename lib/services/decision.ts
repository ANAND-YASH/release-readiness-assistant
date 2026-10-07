// Human release decision. The ONLY code that changes Release.status (also enforced
// by database triggers and a source-scan test). Never called by the AI workflow.

import { recordEvent } from "@/lib/app-log";
import { getDb } from "@/lib/db";
import type { DecisionRequest } from "@/lib/domain/decision";
import { ApiError } from "@/lib/errors";
import type { ReleaseSummary, ServiceContext } from "@/lib/services/releases";
import { getRelease } from "@/lib/services/releases";
import { getReleaseReadiness } from "@/lib/services/readiness";

export async function decideRelease(
  releaseId: string,
  request: DecisionRequest,
  ctx: ServiceContext,
): Promise<ReleaseSummary> {
  const readiness = await getReleaseReadiness(releaseId);
  if (!readiness) throw new ApiError(404, "NOT_FOUND", "Release not found");
  const { release, current, approvalBlockers, latestBrief } = readiness;

  // Rejection is always possible (and reversible); approval must pass every check.
  if (request.decision === "approve" && approvalBlockers.length > 0) {
    await recordEvent(ctx.log, {
      level: "warn",
      event: "release.decision_blocked",
      requestId: ctx.requestId,
      releaseId,
      context: { reviewer: request.reviewer, versionNumber: current.versionNumber, blockers: approvalBlockers.map((b) => b.code) },
    });
    throw new ApiError(422, "APPROVAL_BLOCKED", "The release can't be approved yet.", { blockers: approvalBlockers });
  }

  const status = request.decision === "approve" ? "APPROVED" : "REJECTED";
  const decidedAt = new Date();
  // Compare-and-set on the status read above: a concurrent decision gets a 409.
  const { count } = await getDb().release.updateMany({
    where: { id: releaseId, status: release.status },
    data: {
      status,
      decidedBy: request.reviewer,
      decidedAt,
      decisionNote: request.note || null,
      decidedVersionNumber: current.versionNumber,
    },
  });
  if (count === 0) {
    throw new ApiError(409, "CONFLICT", "The release was decided by someone else in the meantime. Reload and try again.");
  }

  await recordEvent(ctx.log, {
    level: "info",
    event: "release.decided",
    requestId: ctx.requestId,
    releaseId,
    context: {
      decision: request.decision,
      reviewer: request.reviewer,
      fromStatus: release.status,
      toStatus: status,
      versionNumber: current.versionNumber,
      briefId: latestBrief?.id ?? null,
      hasNote: Boolean(request.note),
      timestamp: decidedAt.toISOString(),
    },
  });
  return (await getRelease(releaseId))!;
}
