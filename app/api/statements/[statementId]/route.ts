import { ok, readJson, withApiHandler } from "@/lib/api";
import { ReviewRequestSchema } from "@/lib/domain/review";
import { reviewStatement } from "@/lib/services/review";

/**
 * Human review of a generated statement: { action: "approve" | "reject" | "edit", reviewer, content?, note? }.
 * The only way a statement's review status changes.
 */
export const PATCH = withApiHandler(
  "statements.review",
  async (req, ctx: RouteContext<"/api/statements/[statementId]">, hc) => {
    const { statementId } = await ctx.params;
    const body = await readJson(req, ReviewRequestSchema);
    const result = await reviewStatement(statementId, body, hc);
    hc.annotate({ releaseId: result.releaseId, versionNumber: result.versionNumber });
    return ok(result.statement);
  },
);
