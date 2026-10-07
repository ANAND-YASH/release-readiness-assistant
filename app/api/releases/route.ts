import { ok, readJson, withApiHandler } from "@/lib/api";
import { CreateReleaseBodySchema } from "@/lib/schema/release-requests";
import { createRelease, listReleases } from "@/lib/services/releases";

export const GET = withApiHandler("releases.list", async () => ok(await listReleases()));

export const POST = withApiHandler("releases.create", async (req, _ctx, hc) => {
  const body = await readJson(req, CreateReleaseBodySchema);
  const result = await createRelease(body, hc);
  hc.annotate({ releaseId: result.release.id, versionNumber: 1 });
  return ok(result, 201);
});
