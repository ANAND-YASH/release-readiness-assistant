import { ApiError, ok, withApiHandler } from "@/lib/api";
import { parseVersionNumber } from "@/lib/http/params";
import { getReviewData } from "@/lib/services/analysis";

/**
 * Statements to review for a version (its own latest successful run, or carried over
 * from the most recent earlier analysis), each with staleness relative to the current version.
 */
export const GET = withApiHandler(
  "releases.versions.analysis.get",
  async (_req, ctx: RouteContext<"/api/releases/[releaseId]/versions/[versionNumber]/analysis">, hc) => {
    const params = await ctx.params;
    const versionNumber = parseVersionNumber(params.versionNumber);
    hc.annotate({ releaseId: params.releaseId, versionNumber });
    const review = await getReviewData(params.releaseId, versionNumber);
    if (!review) throw new ApiError(404, "NOT_FOUND", "Version not found");
    return ok(review);
  },
);
