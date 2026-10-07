import { ApiError, ok, readJson, withApiHandler } from "@/lib/api";
import { BriefRequestSchema } from "@/lib/domain/decision";
import { generateBrief } from "@/lib/services/brief";
import { getReleaseReadiness } from "@/lib/services/readiness";

/** Generate the final brief for the current version from human-reviewed statements ({ reviewer }). */
export const POST = withApiHandler("releases.brief.generate", async (req, ctx: RouteContext<"/api/releases/[releaseId]/brief">, hc) => {
  const { releaseId } = await ctx.params;
  hc.annotate({ releaseId });
  const { reviewer } = await readJson(req, BriefRequestSchema);
  const { brief, created } = await generateBrief(releaseId, reviewer, hc);
  hc.annotate({ versionNumber: brief.versionNumber });
  return ok(brief, created ? 201 : 200);
});

/** Latest brief for the current version plus what currently blocks generation/approval. */
export const GET = withApiHandler("releases.brief.get", async (_req, ctx: RouteContext<"/api/releases/[releaseId]/brief">, hc) => {
  const { releaseId } = await ctx.params;
  hc.annotate({ releaseId });
  const readiness = await getReleaseReadiness(releaseId);
  if (!readiness) throw new ApiError(404, "NOT_FOUND", "Release not found");
  return ok({
    versionNumber: readiness.current.versionNumber,
    brief: readiness.latestBrief,
    briefUpToDate: readiness.briefUpToDate,
    briefBlockers: readiness.briefBlockers,
    approvalBlockers: readiness.approvalBlockers,
  });
});
