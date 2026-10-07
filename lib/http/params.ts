import { ApiError } from "@/lib/errors";

/** Parse a positive integer version number from a route segment; anything else is a 404. */
export function parseVersionNumber(raw: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new ApiError(404, "NOT_FOUND", "Version not found");
  return Number(raw);
}
