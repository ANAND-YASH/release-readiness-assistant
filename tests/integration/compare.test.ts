import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as compareRoute } from "@/app/api/releases/[releaseId]/compare/route";
import { GET as analysisRoute } from "@/app/api/releases/[releaseId]/versions/[versionNumber]/analysis/route";
import { PATCH as reviewRoute } from "@/app/api/statements/[statementId]/route";
import { MockProvider } from "@/lib/ai/mock-provider";
import { runAnalysis } from "@/lib/ai/run-analysis";
import { getDb } from "@/lib/db";
import { createRelease, createSampleRelease, createVersion, getVersion } from "@/lib/services/releases";
import { validPackage } from "../fixtures/release-package";
import { ctx, jsonRequest, params, releaseBody, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => getDb().$disconnect());

async function compare(releaseId: string, query: string) {
  const res = await compareRoute(new Request(`http://test/api/releases/${releaseId}/compare${query}`), params({ releaseId }));
  return { status: res.status, body: await res.json() };
}

/** Sample release with the mock analysis run on v1 (so v2 makes some of it stale). */
async function sampleWithV1Analysis() {
  const release = await createSampleRelease(ctx);
  const { runId } = await runAnalysis(release.id, 1, { ...ctx, provider: new MockProvider() });
  return { release, runId };
}

describe("GET /api/releases/:id/compare", () => {
  it("returns added, removed, modified and unchanged items with field-level and package-level diffs", async () => {
    const { release } = await sampleWithV1Analysis();
    const { status, body } = await compare(release.id, "?from=1&to=2");
    expect(status).toBe(200);
    const data = body.data;

    expect(data.fromVersion.versionNumber).toBe(1);
    expect(data.toVersion).toMatchObject({ versionNumber: 2, changeNote: expect.stringContaining("50k") });
    const ids = (list: { id: string }[]) => list.map((i) => i.id).sort();
    expect(ids(data.added)).toEqual(["FIX-3", "MIG-3", "QA-7"]);
    expect(ids(data.removed)).toEqual(["FEAT-3", "LIM-2", "QA-6"]);
    expect(ids(data.modified)).toEqual(["CHG-1", "FEAT-1", "LIM-1", "QA-1", "QA-2"]);
    expect(data.counts).toEqual({ added: 3, removed: 3, modified: 5, unchanged: 9 });

    const feat1 = data.modified.find((i: { id: string }) => i.id === "FEAT-1");
    expect(feat1.fields).toEqual([
      expect.objectContaining({ field: "description", before: expect.stringContaining("10,000"), after: expect.stringContaining("50,000") }),
    ]);
    // Same covering QA item, but its content changed: flagged so the reviewer can see why coverage differs.
    expect(feat1.qaCoverage).toEqual({ before: ["QA-1 (pass)"], after: ["QA-1 (pass, evidence updated)"] });
    const qa2 = data.modified.find((i: { id: string }) => i.id === "QA-2");
    expect(qa2.fields).toContainEqual(expect.objectContaining({ field: "result", before: "partial", after: "pass" }));
    expect(data.scalarChanges.map((s: { field: string }) => s.field)).toEqual(["qaSummary"]);
  });

  it("returns stale statements of the from-version analysis with reasons, and counts the rest", async () => {
    const { release, runId } = await sampleWithV1Analysis();
    const { body } = await compare(release.id, "?from=1&to=2");
    const data = body.data;
    const total = await getDb().generatedStatement.count({ where: { runId } });

    expect(data.fromAnalysis).toEqual({ runId, statementCount: total });
    expect(data.staleStatements.length + data.freshStatementCount).toBe(total);
    expect(data.staleStatements.length).toBeGreaterThan(0);
    expect(data.freshStatementCount).toBeGreaterThan(0);

    const reasons = data.staleStatements.flatMap((s: { stale: { reasons: string[] } }) => s.stale.reasons);
    expect(reasons).toContain("FEAT-1 was modified");
    expect(reasons).toContain("FEAT-3 was removed");
    expect(reasons).toContain("QA evidence for FEAT-2 changed");
    // Statements about untouched items (FIX-1 is unchanged and so is its QA) are not stale.
    const staleCiting = (id: string) =>
      data.staleStatements.filter((s: { citations: { itemId: string }[] }) => s.citations.some((c) => c.itemId === id));
    expect(staleCiting("FIX-1")).toEqual([]);
  });

  it("does not mutate the original statements or their citations", async () => {
    const { release, runId } = await sampleWithV1Analysis();
    const before = await getDb().generatedStatement.findMany({ where: { runId }, orderBy: { order: "asc" } });
    await compare(release.id, "?from=1&to=2");
    const after = await getDb().generatedStatement.findMany({ where: { runId }, orderBy: { order: "asc" } });
    expect(after).toEqual(before);
    const v1 = await getVersion(release.id, 1);
    for (const s of after) {
      for (const c of s.citations as { itemId: string; itemHash: string }[]) expect(c.itemHash).toBe(v1!.itemHashes[c.itemId]);
    }
  });

  it("reports no analysis when the from-version has none", async () => {
    const release = await createSampleRelease(ctx);
    const { body } = await compare(release.id, "?from=1&to=2");
    expect(body.data.fromAnalysis).toBeNull();
    expect(body.data.staleStatements).toEqual([]);
  });

  it.each([
    ["?from=2&to=2", 400, "VALIDATION_ERROR"],
    ["?from=0&to=2", 400, "VALIDATION_ERROR"],
    ["?from=abc&to=2", 400, "VALIDATION_ERROR"],
    ["?to=2", 400, "VALIDATION_ERROR"],
    ["?from=1&to=9", 404, "NOT_FOUND"],
  ])("rejects %s with %i", async (query, status, code) => {
    const release = await createSampleRelease(ctx);
    const res = await compare(release.id, query);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it("returns 404 for an unknown release and for versions that only exist in another release", async () => {
    expect((await compare("missing", "?from=1&to=2")).status).toBe(404);
    const single = await createRelease(releaseBody(validPackage()), ctx); // only v1
    await createSampleRelease(ctx); // has v2
    const res = await compare(single.release.id, "?from=1&to=2");
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain("Version 2 not found");
  });
});

describe("staleness on the review data for the current version", () => {
  it("carries the previous analysis forward and marks only affected statements STALE", async () => {
    const { release, runId } = await sampleWithV1Analysis();
    const res = await analysisRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber: "2" }));
    const data = (await res.json()).data;

    expect(data.carriedFrom).toBe(1);
    expect(data.currentVersionNumber).toBe(2);
    expect(data.statementsRun.id).toBe(runId);
    const stale = data.statements.filter((s: { stale: { stale: boolean } }) => s.stale.stale);
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.length).toBeLessThan(data.statements.length);

    // v1's own review page is checked against the current version too.
    const v1 = await (await analysisRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber: "1" }))).json();
    expect(v1.data.carriedFrom).toBeNull();
    expect(v1.data.statements.filter((s: { stale: { stale: boolean } }) => s.stale.stale)).toHaveLength(stale.length);
  });

  it("a fresh analysis of the current version has no stale statements", async () => {
    const release = await createSampleRelease(ctx);
    await runAnalysis(release.id, 2, { ...ctx, provider: new MockProvider() });
    const data = (await (await analysisRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber: "2" }))).json()).data;
    expect(data.carriedFrom).toBeNull();
    expect(data.statements.every((s: { stale: { stale: boolean } }) => !s.stale.stale)).toBe(true);
  });

  it("stale statements can be rejected but not approved or edited; fresh carried statements can be approved", async () => {
    const { release } = await sampleWithV1Analysis();
    const data = (await (await analysisRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber: "2" }))).json()).data;
    const stale = data.statements.find((s: { stale: { stale: boolean } }) => s.stale.stale);
    const fresh = data.statements.find((s: { stale: { stale: boolean } }) => !s.stale.stale);
    const patch = async (id: string, body: object) =>
      (await reviewRoute(jsonRequest(`/api/statements/${id}`, { reviewer: "Ada", ...body }, "PATCH"), params({ statementId: id }))).status;

    expect(await patch(stale.id, { action: "approve" })).toBe(409);
    expect(await patch(stale.id, { action: "edit", content: "Rewritten" })).toBe(409);
    expect(await patch(stale.id, { action: "reject" })).toBe(200);
    expect(await patch(fresh.id, { action: "approve" })).toBe(200);
  });

  it("creating a new version leaves earlier statements attached to their run and version", async () => {
    const { release, runId } = await sampleWithV1Analysis();
    const v2 = await getVersion(release.id, 2);
    await createVersion(
      release.id,
      { package: { ...v2!.package, qaSummary: "Updated summary for v3." }, changeNote: "Tweak QA summary", baseVersionNumber: 2 },
      ctx,
    );
    const v1 = await getVersion(release.id, 1);
    const statements = await getDb().generatedStatement.findMany({ where: { runId } });
    expect(statements.every((s) => s.versionId === v1!.id && s.runId === runId)).toBe(true);
    expect((await getDb().release.findUniqueOrThrow({ where: { id: release.id } })).status).toBe("DRAFT");
  });
});
