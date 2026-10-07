import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./", import.meta.url)) };

/**
 * Integration tests run against a separate database so they never touch dev data.
 * TEST_DATABASE_URL wins; otherwise DATABASE_URL's database name gets a `_test` suffix.
 * Returns undefined (instead of throwing) so unit tests run without a database;
 * tests/integration/global-setup.ts reports the problem.
 */
function integrationDatabaseUrl(): string | undefined {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) return undefined;
  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.pathname.endsWith("_test") ? url.toString() : undefined;
}

const testDbUrl = integrationDatabaseUrl();
// Read by global-setup, which runs in this (main) process.
if (testDbUrl) process.env.INTEGRATION_DATABASE_URL = testDbUrl;

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          env: { LOG_LEVEL: "silent" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          env: { ...(testDbUrl ? { DATABASE_URL: testDbUrl } : {}), LOG_LEVEL: "silent" },
          // Tests share one database; run files sequentially.
          fileParallelism: false,
        },
      },
    ],
  },
});
