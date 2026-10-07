import { ApiError, ok, withApiHandler } from "@/lib/api";
import { parseVersionNumber } from "@/lib/http/params";
import { getVersion } from "@/lib/services/releases";

export const GET = withApiHandler(
  "releases.versions.get",
  async (_req, ctx: RouteContext<"/api/releases/[releaseId]/versions/[versionNumber]">, hc) => {
    const params = await ctx.params;
    const versionNumber = parseVersionNumber(params.versionNumber);
    hc.annotate({ releaseId: params.releaseId, versionNumber });
    const version = await getVersion(params.releaseId, versionNumber);
    if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");
    return ok(version);
  },
);
