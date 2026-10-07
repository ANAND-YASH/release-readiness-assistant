import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { computeItemHashes, hashPackage } from "@/lib/domain/hash";
import { ApiError } from "@/lib/errors";
import { createRelease, createSampleRelease, createVersion, getRelease, getVersion } from "@/lib/services/releases";
import { validPackage } from "../fixtures/release-package";
import { ctx, releaseBody, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => getDb().$disconnect());

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status, code });
  return err as ApiError;
}

describe("createRelease", () => {
  it("creates the release with an immutable version 1 snapshot", async () => {
    const pkg = validPackage();
    const { release, version } = await createRelease(releaseBody(pkg), ctx);

    expect(release).toMatchObject({ name: "Payments 1.0", status: "DRAFT", targetDate: "2026-12-01" });
    expect(release.latestVersion?.versionNumber).toBe(1);
    expect(version.versionNumber).toBe(1);

    const row = await getDb().releaseVersion.findUniqueOrThrow({
      where: { releaseId_versionNumber: { releaseId: release.id, versionNumber: 1 } },
    });
    expect(row.package).toEqual(pkg);
    expect(row.itemHashes).toEqual(computeItemHashes(pkg));
    expect(row.packageHash).toBe(hashPackage(pkg));
    expect(row.validation).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("blocks packages with validation errors and persists nothing", async () => {
    const pkg = { ...validPackage(), qaSummary: "" };
    const err = await expectApiError(createRelease(releaseBody(pkg), ctx), 422, "PACKAGE_INVALID");
    expect((err.details as { errors: { code: string }[] }).errors.map((e) => e.code)).toEqual([
      "QA_SUMMARY_MISSING",
    ]);
    expect(await getDb().release.count()).toBe(0);
  });

  it("rejects QA evidence that references unknown items", async () => {
    const pkg = validPackage();
    pkg.qaEvidence[0].coversItemIds = ["FEAT-404"];
    const err = await expectApiError(createRelease(releaseBody(pkg), ctx), 422, "PACKAGE_INVALID");
    expect((err.details as { errors: { code: string; path: string }[] }).errors).toContainEqual(
      expect.objectContaining({ code: "QA_UNKNOWN_COVERED_ITEM", path: "qaEvidence[0].coversItemIds[0]" }),
    );
    expect(await getDb().releaseVersion.count()).toBe(0);
  });

  it("stores warnings with the version and records an AppLog event", async () => {
    const pkg = validPackage();
    pkg.qaEvidence[0].result = "partial";
    const { release, version } = await createRelease(releaseBody(pkg), ctx);
    expect(version.validation.warnings.map((w) => w.code)).toEqual(["QA_NOT_PASSED"]);

    const logs = await getDb().appLog.findMany({ where: { releaseId: release.id } });
    expect(logs).toEqual([
      expect.objectContaining({
        event: "release.created",
        level: "INFO",
        requestId: "test-request",
        context: expect.objectContaining({ versionNumber: 1, warningCount: 1 }),
      }),
    ]);
  });
});

describe("createVersion", () => {
  async function seedRelease() {
    return (await createRelease(releaseBody(validPackage()), ctx)).release;
  }

  function edited(title: string) {
    const pkg = validPackage();
    pkg.features[0].title = title;
    return pkg;
  }

  it("creates a new version and leaves the previous version unchanged", async () => {
    const release = await seedRelease();
    const before = await getDb().releaseVersion.findFirstOrThrow({ where: { releaseId: release.id } });

    const v2 = await createVersion(
      release.id,
      { package: edited("Bulk export v2"), changeNote: "Rename feature", baseVersionNumber: 1 },
      ctx,
    );
    expect(v2.versionNumber).toBe(2);
    expect(v2.changeNote).toBe("Rename feature");

    const after = await getDb().releaseVersion.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toEqual(before);
    expect(v2.itemHashes["FEAT-1"]).not.toBe((before.itemHashes as Record<string, string>)["FEAT-1"]);
    expect(v2.itemHashes["FIX-1"]).toBe((before.itemHashes as Record<string, string>)["FIX-1"]);
  });

  it("increments version numbers sequentially", async () => {
    const release = await seedRelease();
    for (const [i, title] of ["A", "B", "C"].entries()) {
      const v = await createVersion(
        release.id,
        { package: edited(title), changeNote: `Edit ${title}`, baseVersionNumber: i + 1 },
        ctx,
      );
      expect(v.versionNumber).toBe(i + 2);
    }
    const detail = await getRelease(release.id);
    expect(detail?.versions.map((v) => v.versionNumber)).toEqual([4, 3, 2, 1]);
  });

  it("rejects an edit based on a stale version (409) without creating a version", async () => {
    const release = await seedRelease();
    await createVersion(release.id, { package: edited("A"), changeNote: "First", baseVersionNumber: 1 }, ctx);
    await expectApiError(
      createVersion(release.id, { package: edited("B"), changeNote: "Second", baseVersionNumber: 1 }, ctx),
      409,
      "CONFLICT",
    );
    expect(await getDb().releaseVersion.count({ where: { releaseId: release.id } })).toBe(2);
  });

  it("rejects saving an unchanged package", async () => {
    const release = await seedRelease();
    await expectApiError(
      createVersion(release.id, { package: validPackage(), changeNote: "No-op", baseVersionNumber: 1 }, ctx),
      422,
      "NO_CHANGES",
    );
  });

  it("validates new versions too", async () => {
    const release = await seedRelease();
    const pkg = validPackage();
    pkg.qaEvidence[1].coversItemIds = ["FIX-99"];
    await expectApiError(
      createVersion(release.id, { package: pkg, changeNote: "Bad ref", baseVersionNumber: 1 }, ctx),
      422,
      "PACKAGE_INVALID",
    );
    expect(await getVersion(release.id, 2)).toBeNull();
  });

  it("rejects reusing the ID of an item deleted in an earlier version", async () => {
    const release = await seedRelease();
    const withoutFix = validPackage();
    withoutFix.bugFixes = [];
    withoutFix.qaEvidence = withoutFix.qaEvidence.filter((qa) => qa.id !== "QA-2");
    await createVersion(release.id, { package: withoutFix, changeNote: "Drop FIX-1", baseVersionNumber: 1 }, ctx);

    const reused = structuredClone(withoutFix);
    reused.bugFixes = [{ id: "FIX-1", title: "A different bug", description: "Unrelated to the old FIX-1 entirely.", userGroups: [] }];
    reused.qaEvidence.push({ id: "QA-4", title: "Covers it", result: "pass", coversItemIds: ["FIX-1"], notes: "" });
    const err = await expectApiError(
      createVersion(release.id, { package: reused, changeNote: "Re-add", baseVersionNumber: 2 }, ctx),
      422,
      "PACKAGE_INVALID",
    );
    expect((err.details as { errors: { code: string }[] }).errors.map((e) => e.code)).toEqual(["ITEM_ID_REUSED"]);
  });

  it("returns 404 for an unknown release", async () => {
    await expectApiError(
      createVersion("missing", { package: validPackage(), changeNote: "x".repeat(5), baseVersionNumber: 1 }, ctx),
      404,
      "NOT_FOUND",
    );
  });
});

describe("immutability", () => {
  it("the database rejects any UPDATE of a release version", async () => {
    const { release } = await createRelease(releaseBody(validPackage()), ctx);
    await expect(
      getDb().releaseVersion.updateMany({ where: { releaseId: release.id }, data: { changeNote: "tampered" } }),
    ).rejects.toThrow(/immutable/);
    expect((await getVersion(release.id, 1))?.changeNote).toBe("Initial version");
  });
});

describe("createSampleRelease", () => {
  it("creates the demo release with two versions", async () => {
    const release = await createSampleRelease(ctx);
    expect(release.latestVersion?.versionNumber).toBe(2);
    const v1 = await getVersion(release.id, 1);
    const v2 = await getVersion(release.id, 2);
    expect(v1?.packageHash).not.toBe(v2?.packageHash);
  });
});
