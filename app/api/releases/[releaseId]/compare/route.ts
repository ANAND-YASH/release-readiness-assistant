import { z } from "zod";
import { ok, parseOrThrow, withApiHandler } from "@/lib/api";
import { compareVersions } from "@/lib/services/compare";

const versionParam = z
  .string({ error: "Required" })
  .regex(/^[1-9]\d{0,8}$/, "Must be a positive integer version number")
  .transform(Number);

const CompareQuerySchema = z.object({ from: versionParam, to: versionParam });

/** GET /api/releases/:releaseId/compare?from=<n>&to=<n> */
export const GET = withApiHandler(
  "releases.compare",
  async (req, ctx: RouteContext<"/api/releases/[releaseId]/compare">, hc) => {
    const { releaseId } = await ctx.params;
    hc.annotate({ releaseId });
    const url = new URL(req.url);
    const query = parseOrThrow(
      CompareQuerySchema,
      { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined },
      "Invalid comparison query",
    );
    const comparison = await compareVersions(releaseId, query.from, query.to);
    hc.log.info("compare.completed", {
      releaseId,
      from: query.from,
      to: query.to,
      counts: comparison.counts,
      staleStatements: comparison.staleStatements.length,
    });
    return ok(comparison);
  },
);
