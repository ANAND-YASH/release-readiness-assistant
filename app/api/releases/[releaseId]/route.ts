import { ApiError, ok, withApiHandler } from "@/lib/api";
import { getRelease } from "@/lib/services/releases";

export const GET = withApiHandler(
  "releases.get",
  async (_req, ctx: RouteContext<"/api/releases/[releaseId]">, hc) => {
    const { releaseId } = await ctx.params;
    hc.annotate({ releaseId });
    const release = await getRelease(releaseId);
    if (!release) throw new ApiError(404, "NOT_FOUND", "Release not found");
    return ok(release);
  },
);
