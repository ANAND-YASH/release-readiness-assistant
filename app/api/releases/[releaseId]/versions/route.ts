import { ok, readJson, withApiHandler } from "@/lib/api";
import { CreateVersionBodySchema } from "@/lib/schema/release-requests";
import { createVersion } from "@/lib/services/releases";

/** Saving an edited package always creates a new version; existing versions are never modified. */
export const POST = withApiHandler(
  "releases.versions.create",
  async (req, ctx: RouteContext<"/api/releases/[releaseId]/versions">, hc) => {
    const { releaseId } = await ctx.params;
    hc.annotate({ releaseId });
    const body = await readJson(req, CreateVersionBodySchema);
    const version = await createVersion(releaseId, body, hc);
    hc.annotate({ versionNumber: version.versionNumber });
    return ok(version, 201);
  },
);
