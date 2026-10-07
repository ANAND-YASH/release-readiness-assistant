import { execSync } from "node:child_process";
import { Client } from "pg";
/** Creates the test database if needed and applies all migrations. */
export default async function setup() {
  const resolved = process.env.INTEGRATION_DATABASE_URL;
  if (!resolved) {
    throw new Error(
      "Integration tests need DATABASE_URL (or TEST_DATABASE_URL, whose database name must end in _test).",
    );
  }
  const url = new URL(resolved);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Integration tests need PostgreSQL. Start it with \`npm run db:up\`. (${(err as Error).message})`);
  }
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
}
