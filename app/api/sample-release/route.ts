import { ok, withApiHandler } from "@/lib/api";
import { createSampleRelease } from "@/lib/services/releases";

/** Creates the demo release (two versions) so reviewers don't have to type a package by hand. */
export const POST = withApiHandler("sample-release.create", async (_req, _ctx, hc) => {
  const release = await createSampleRelease(hc);
  hc.annotate({ releaseId: release.id, versionNumber: release.latestVersion?.versionNumber });
  return ok(release, 201);
});
