import { ApiError, ok, parseOrThrow, withApiHandler } from "@/lib/api";
import { validatePackage } from "@/lib/domain/validate-package";
import { parseVersionNumber } from "@/lib/http/params";
import { ValidateBodySchema } from "@/lib/schema/release-requests";
import { getVersion } from "@/lib/services/releases";

/**
 * Deterministic validation without saving anything.
 * - Empty body: re-validates the stored snapshot of this version.
 * - Body `{ package }`: dry-run validation of a candidate edit of this version.
 */
export const POST = withApiHandler(
  "releases.versions.validate",
  async (req, ctx: RouteContext<"/api/releases/[releaseId]/versions/[versionNumber]/validate">, hc) => {
    const params = await ctx.params;
    const versionNumber = parseVersionNumber(params.versionNumber);
    hc.annotate({ releaseId: params.releaseId, versionNumber });

    const version = await getVersion(params.releaseId, versionNumber);
    if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");

    const raw = await req.text();
    if (raw.trim() === "") return ok(validatePackage(version.package));

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON");
    }
    const { package: candidate } = parseOrThrow(ValidateBodySchema, body, "Request body failed validation");
    return ok(validatePackage(candidate));
  },
);
