import { ApiError, ok, withApiHandler } from "@/lib/api";
import { runAnalysis } from "@/lib/ai/run-analysis";
import { parseVersionNumber } from "@/lib/http/params";
import { getVersionAnalysis } from "@/lib/services/analysis";
import { getVersion } from "@/lib/services/releases";

// Two model calls plus one possible retry each.
export const maxDuration = 120;

/**
 * Runs the AI analysis workflow for a version and returns the new statements
 * (all PENDING). Never changes Release.status and never approves anything.
 */
export const POST = withApiHandler(
  "releases.versions.analyze",
  async (_req, ctx: RouteContext<"/api/releases/[releaseId]/versions/[versionNumber]/analyze">, hc) => {
    const params = await ctx.params;
    const versionNumber = parseVersionNumber(params.versionNumber);
    hc.annotate({ releaseId: params.releaseId, versionNumber });

    const outcome = await runAnalysis(params.releaseId, versionNumber, hc);
    const version = await getVersion(params.releaseId, versionNumber);
    if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");
    const analysis = await getVersionAnalysis(version.id);
    return ok({ ...outcome, ...analysis }, 201);
  },
);
