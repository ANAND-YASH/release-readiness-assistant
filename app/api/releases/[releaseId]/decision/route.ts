import { ok, readJson, withApiHandler } from "@/lib/api";
import { DecisionRequestSchema } from "@/lib/domain/decision";
import { decideRelease } from "@/lib/services/decision";

/**
 * Human release decision: { decision: "approve" | "reject", reviewer, note? }.
 * The only way Release.status changes. Approval is blocked until every readiness
 * condition holds; rejection is always allowed and can be revised later.
 */
export const POST = withApiHandler("releases.decision", async (req, ctx: RouteContext<"/api/releases/[releaseId]/decision">, hc) => {
  const { releaseId } = await ctx.params;
  hc.annotate({ releaseId });
  const body = await readJson(req, DecisionRequestSchema);
  const release = await decideRelease(releaseId, body, hc);
  hc.annotate({ versionNumber: release.decision?.versionNumber ?? undefined });
  return ok(release);
});
