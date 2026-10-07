// Final brief generation: deterministic assembly of human-reviewed statements for
// the current version, persisted as a FinalBrief. Never changes Release.status.

import { recordEvent } from "@/lib/app-log";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import type { ServiceContext } from "@/lib/services/releases";
import { getReleaseReadiness, type FinalBriefDto } from "@/lib/services/readiness";

export async function generateBrief(
  releaseId: string,
  reviewer: string,
  ctx: ServiceContext,
): Promise<{ brief: FinalBriefDto; created: boolean }> {
  const readiness = await getReleaseReadiness(releaseId);
  if (!readiness) throw new ApiError(404, "NOT_FOUND", "Release not found");
  const { current, assembled, briefBlockers, latestBrief } = readiness;

  if (!assembled) {
    await recordEvent(ctx.log, {
      level: "warn",
      event: "brief.blocked",
      requestId: ctx.requestId,
      releaseId,
      context: { versionNumber: current.versionNumber, blockers: briefBlockers.map((b) => b.code) },
    });
    throw new ApiError(422, "BRIEF_BLOCKED", "The final brief can't be generated yet.", { blockers: briefBlockers });
  }

  // Deterministic: regenerating an unchanged brief returns the existing record.
  if (latestBrief && latestBrief.markdown === assembled.markdown) return { brief: latestBrief, created: false };

  const row = await getDb().finalBrief.create({
    data: {
      releaseId,
      versionId: current.id,
      markdown: assembled.markdown,
      statementIds: assembled.statementIds,
      generatedBy: reviewer,
    },
  });
  await recordEvent(ctx.log, {
    level: "info",
    event: "brief.generated",
    requestId: ctx.requestId,
    releaseId,
    context: {
      briefId: row.id,
      versionNumber: current.versionNumber,
      generatedBy: reviewer,
      statementCount: assembled.statementIds.length,
      sections: assembled.sections.map((s) => `${s.title}:${s.statementIds.length}`),
    },
  });
  return {
    brief: {
      id: row.id,
      versionNumber: current.versionNumber,
      markdown: row.markdown,
      statementIds: assembled.statementIds,
      generatedBy: row.generatedBy,
      createdAt: row.createdAt.toISOString(),
    },
    created: true,
  };
}
