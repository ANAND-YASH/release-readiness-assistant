// Seeds the demo release (two versions). Idempotent: skips if it already exists.
import "dotenv/config";
import { getDb } from "@/lib/db";
import { log } from "@/lib/log";
import { SAMPLE_RELEASE } from "@/lib/sample-data";
import { createSampleRelease } from "@/lib/services/releases";

async function main() {
  const db = getDb();
  const existing = await db.release.findFirst({
    where: { name: SAMPLE_RELEASE.name, product: SAMPLE_RELEASE.product },
    select: { id: true },
  });
  if (existing) {
    log.info("seed.skipped", { reason: "sample release already exists", releaseId: existing.id });
    return;
  }
  const release = await createSampleRelease({ log, requestId: "seed" });
  log.info("seed.completed", { releaseId: release.id, versions: release.latestVersion?.versionNumber });
}

main()
  .catch((err) => {
    log.error("seed.failed", { error: err });
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
