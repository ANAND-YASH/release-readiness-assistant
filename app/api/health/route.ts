import { ApiError, ok, withApiHandler } from "@/lib/api";
import { getDb } from "@/lib/db";

export const GET = withApiHandler("health", async () => {
  try {
    await getDb().$queryRaw`SELECT 1`;
  } catch (err) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Database is unreachable", undefined, { cause: err });
  }
  return ok({ status: "ok", database: "ok" });
});
