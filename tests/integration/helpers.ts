import { getDb } from "@/lib/db";
import { createLogger } from "@/lib/log";
import type { ReleasePackage } from "@/lib/schema/release-package";
import type { ServiceContext } from "@/lib/services/releases";

export const ctx: ServiceContext = { log: createLogger({ test: true }), requestId: "test-request" };

export async function resetDb() {
  await getDb().$executeRawUnsafe(`TRUNCATE "AppLog", "Release" RESTART IDENTITY CASCADE`);
}

export function releaseBody(pkg: ReleasePackage) {
  return { name: "Payments 1.0", product: "Payments", targetDate: "2026-12-01", package: pkg };
}

export function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new Request(`http://test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Route context with already-resolved params, as Next.js passes them. */
export function params<P extends Record<string, string>>(p: P) {
  return { params: Promise.resolve(p) };
}
