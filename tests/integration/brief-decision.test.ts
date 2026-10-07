import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as briefRoute } from "@/app/api/releases/[releaseId]/brief/route";
import { POST as decisionRoute } from "@/app/api/releases/[releaseId]/decision/route";
import { PATCH as reviewRoute } from "@/app/api/statements/[statementId]/route";
import { MockProvider } from "@/lib/ai/mock-provider";
import { runAnalysis } from "@/lib/ai/run-analysis";
import { getDb } from "@/lib/db";
import { computeItemHashes, hashPackage } from "@/lib/domain/hash";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getReviewData } from "@/lib/services/analysis";
import { createSampleRelease, createVersion, getVersion } from "@/lib/services/releases";
import { ctx, jsonRequest, params, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => getDb().$disconnect());

const release = (id: string) => getDb().release.findUniqueOrThrow({ where: { id } });

async function brief(releaseId: string, reviewer: string | null = "Ada") {
  const res = await briefRoute(jsonRequest(`/api/releases/${releaseId}/brief`, reviewer === null ? {} : { reviewer }), params({ releaseId }));
  return { status: res.status, body: await res.json() };
}

async function decide(releaseId: string, body: object) {
  const res = await decisionRoute(jsonRequest(`/api/releases/${releaseId}/decision`, body), params({ releaseId }));
  return { status: res.status, body: await res.json() };
}

async function review(statementId: string, body: object) {
  const res = await reviewRoute(
    jsonRequest(`/api/statements/${statementId}`, { reviewer: "Ada", ...body }, "PATCH"),
    params({ statementId }),
  );
  return res.status;
}

/** Sample release with v2 analysed by the mock provider. */
async function analysedSample() {
  const created = await createSampleRelease(ctx);
  const { runId } = await runAnalysis(created.id, 2, { ...ctx, provider: new MockProvider() });
  const statements = await getDb().generatedStatement.findMany({ where: { runId }, orderBy: { order: "asc" } });
  return { releaseId: created.id, runId, statements };
}

/** Reviews every statement: one edited, one rejected, the rest approved. Returns the ids by outcome. */
async function reviewEverything(statements: { id: string; aiContent: string }[]) {
  const [edited, rejected, ...approved] = statements;
  expect(await review(edited.id, { action: "edit", content: "Human-edited wording for the brief." })).toBe(200);
  expect(await review(rejected.id, { action: "reject", note: "Not relevant" })).toBe(200);
  for (const s of approved) expect(await review(s.id, { action: "approve" })).toBe(200);
  return { edited, rejected, approved };
}

const codes = (body: { error: { details: { blockers: { code: string }[] } } }) => body.error.details.blockers.map((b) => b.code);

describe("POST /api/releases/:id/brief", () => {
  it("is blocked without analysis, and while statements are pending", async () => {
    const created = await createSampleRelease(ctx);
    let res = await brief(created.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BRIEF_BLOCKED");
    expect(codes(res.body)).toEqual(["NO_ANALYSIS"]);

    await runAnalysis(created.id, 2, { ...ctx, provider: new MockProvider() });
    res = await brief(created.id);
    expect(codes(res.body)).toEqual(["PENDING_STATEMENTS"]);
    expect(await getDb().finalBrief.count()).toBe(0);
  });

  it("requires a reviewer", async () => {
    const { releaseId } = await analysedSample();
    const res = await brief(releaseId, null);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("reviewer");
  });

  it("assembles only approved/edited statements, with edited text and citations, and persists a FinalBrief", async () => {
    const { releaseId, statements } = await analysedSample();
    const { edited, rejected, approved } = await reviewEverything(statements);

    const res = await brief(releaseId);
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data.versionNumber).toBe(2);
    expect(data.generatedBy).toBe("Ada");
    expect([...data.statementIds].sort()).toEqual([edited.id, ...approved.map((s) => s.id)].sort());
    expect(data.statementIds).not.toContain(rejected.id);

    expect(data.markdown).toContain("Human-edited wording for the brief.");
    expect(data.markdown).not.toContain(edited.aiContent.slice(0, 40));
    expect(data.markdown).toMatch(/\[FEAT-1(, [A-Z]+-\d+)*\]/);
    expect(data.markdown).toContain("## Sources");

    const v2 = await getVersion(releaseId, 2);
    const row = await getDb().finalBrief.findUniqueOrThrow({ where: { id: data.id } });
    expect(row).toMatchObject({ releaseId, versionId: v2!.id, markdown: data.markdown, generatedBy: "Ada" });
    expect(row.statementIds).toEqual(data.statementIds);
    expect(row.createdAt).toBeInstanceOf(Date);

    // Regenerating with nothing changed returns the same brief instead of a duplicate.
    const again = await brief(releaseId, "Grace");
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(data.id);
    expect(await getDb().finalBrief.count()).toBe(1);

    const log = await getDb().appLog.findFirstOrThrow({ where: { event: "brief.generated" } });
    expect(log.context).toMatchObject({ briefId: data.id, versionNumber: 2, generatedBy: "Ada" });
    expect((await release(releaseId)).status).toBe("DRAFT");
  });

  it("is blocked by stale statements after the package changes (current-version requirement)", async () => {
    const { releaseId, statements } = await analysedSample();
    for (const s of statements) await review(s.id, { action: "approve" });
    expect((await brief(releaseId)).status).toBe(201);

    const v2 = await getVersion(releaseId, 2);
    const pkg = structuredClone(v2!.package);
    pkg.features[0].title = "Bulk invoice export (async)";
    await createVersion(releaseId, { package: pkg, changeNote: "Rename FEAT-1", baseVersionNumber: 2 }, ctx);

    const res = await brief(releaseId);
    expect(res.status).toBe(422);
    expect(codes(res.body)).toEqual(["STALE_STATEMENTS"]);

    // Rejecting the stale statements resolves the blocker; the brief is then for v3.
    const review3 = await getReviewData(releaseId, 3);
    for (const s of review3!.statements.filter((x) => x.stale.stale)) await review(s.id, { action: "reject" });
    const ok = await brief(releaseId);
    expect(ok.status).toBe(201);
    expect(ok.body.data.versionNumber).toBe(3);
    expect(ok.body.data.markdown).not.toContain("Bulk invoice export: medium impact");
  });

  it("is blocked when items were added after the analysis", async () => {
    const { releaseId, statements } = await analysedSample();
    for (const s of statements) await review(s.id, { action: "approve" });
    const v2 = await getVersion(releaseId, 2);
    const pkg = structuredClone(v2!.package);
    pkg.bugFixes.push({ id: "FIX-4", title: "New fix", description: "Fixes a rounding error in invoice totals.", userGroups: [] });
    await createVersion(releaseId, { package: pkg, changeNote: "Add FIX-4", baseVersionNumber: 2 }, ctx);
    expect(codes((await brief(releaseId)).body)).toContain("UNANALYSED_ITEMS");
  });

  it("is blocked by validation errors on the current version and when nothing usable is approved", async () => {
    const { releaseId, statements } = await analysedSample();
    for (const s of statements) await review(s.id, { action: "reject" });
    expect(codes((await brief(releaseId)).body)).toEqual(["NO_USABLE_STATEMENTS"]);

    // A legacy-style invalid current version (saving would reject it).
    const v2 = await getVersion(releaseId, 2);
    const invalid = { ...v2!.package, qaSummary: "" };
    await getDb().releaseVersion.create({
      data: {
        releaseId,
        versionNumber: 3,
        package: invalid as unknown as Prisma.InputJsonObject,
        itemHashes: computeItemHashes(invalid),
        packageHash: hashPackage(invalid),
        validation: { valid: true, errors: [], warnings: [] },
      },
    });
    expect(codes((await brief(releaseId)).body)).toContain("VALIDATION_ERRORS");
  });
});

describe("POST /api/releases/:id/decision", () => {
  it.each([
    [{ decision: "approve" }, "reviewer"],
    [{ decision: "approve", reviewer: "" }, "reviewer"],
    [{ decision: "deploy", reviewer: "Ada" }, "decision"],
  ])("rejects invalid request %j with 400", async (body, field) => {
    const { releaseId } = await analysedSample();
    const res = await decide(releaseId, body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe(field);
  });

  it("blocks approval while statements are pending", async () => {
    const { releaseId } = await analysedSample();
    const res = await decide(releaseId, { decision: "approve", reviewer: "Ada" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("APPROVAL_BLOCKED");
    expect(codes(res.body)).toEqual(["PENDING_STATEMENTS", "BRIEF_MISSING"]);
    expect((await release(releaseId)).status).toBe("DRAFT");
  });

  it("blocks approval when no final brief exists, and when the brief is outdated", async () => {
    const { releaseId, statements } = await analysedSample();
    for (const s of statements) await review(s.id, { action: "approve" });
    expect(codes((await decide(releaseId, { decision: "approve", reviewer: "Ada" })).body)).toEqual(["BRIEF_MISSING"]);

    await brief(releaseId);
    await review(statements[0].id, { action: "edit", content: "Changed after the brief was generated." });
    expect(codes((await decide(releaseId, { decision: "approve", reviewer: "Ada" })).body)).toEqual(["BRIEF_OUTDATED"]);
  });

  it("blocks approval when statements are stale", async () => {
    const { releaseId, statements } = await analysedSample();
    for (const s of statements) await review(s.id, { action: "approve" });
    await brief(releaseId);
    const v2 = await getVersion(releaseId, 2);
    const pkg = structuredClone(v2!.package);
    pkg.changedBehaviour[0].breaking = false;
    await createVersion(releaseId, { package: pkg, changeNote: "Not breaking", baseVersionNumber: 2 }, ctx);
    const res = await decide(releaseId, { decision: "approve", reviewer: "Ada" });
    expect(codes(res.body)).toEqual(["STALE_STATEMENTS", "BRIEF_MISSING"]);
  });

  it("approves when every condition holds, recording the decision and an audit log", async () => {
    const { releaseId, statements } = await analysedSample();
    await reviewEverything(statements);
    const generated = (await brief(releaseId)).body.data;

    const res = await decide(releaseId, { decision: "approve", reviewer: "Grace Hopper", note: "Ship after 6pm" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "APPROVED",
      decision: { decidedBy: "Grace Hopper", note: "Ship after 6pm", versionNumber: 2 },
    });
    const row = await release(releaseId);
    expect(row).toMatchObject({ status: "APPROVED", decidedBy: "Grace Hopper", decisionNote: "Ship after 6pm", decidedVersionNumber: 2 });
    expect(row.decidedAt).toBeInstanceOf(Date);

    const log = await getDb().appLog.findFirstOrThrow({ where: { event: "release.decided" } });
    expect(log.requestId).toEqual(expect.any(String));
    expect(log.context).toMatchObject({
      decision: "approve",
      reviewer: "Grace Hopper",
      fromStatus: "DRAFT",
      toStatus: "APPROVED",
      versionNumber: 2,
      briefId: generated.id,
      hasNote: true,
    });
  });

  it("rejection is always possible, deletes nothing, and can be followed by more review and approval", async () => {
    const { releaseId, statements } = await analysedSample();
    const res = await decide(releaseId, { decision: "reject", reviewer: "Ada", note: "QA gaps on CHG-2" });
    expect(res.status).toBe(200);
    expect(await release(releaseId)).toMatchObject({ status: "REJECTED", decisionNote: "QA gaps on CHG-2", decidedBy: "Ada" });
    expect(await getDb().generatedStatement.count({ where: { versionId: statements[0].versionId } })).toBe(statements.length);

    await reviewEverything(statements);
    expect((await brief(releaseId)).status).toBe(201);
    const approved = await decide(releaseId, { decision: "approve", reviewer: "Grace" });
    expect(approved.status).toBe(200);
    expect(await release(releaseId)).toMatchObject({ status: "APPROVED", decidedBy: "Grace", decisionNote: null });
    expect(await getDb().appLog.count({ where: { event: "release.decided" } })).toBe(2);
  });
});

describe("human-only release status", () => {
  it("AI analysis cannot approve or reject: status is unchanged for APPROVED and REJECTED releases", async () => {
    const { releaseId, statements } = await analysedSample();
    await reviewEverything(statements);
    await brief(releaseId);
    await decide(releaseId, { decision: "approve", reviewer: "Ada" });
    await runAnalysis(releaseId, 2, { ...ctx, provider: new MockProvider() });
    expect((await release(releaseId)).status).toBe("APPROVED");

    await decide(releaseId, { decision: "reject", reviewer: "Ada" });
    const before = await release(releaseId);
    await runAnalysis(releaseId, 2, { ...ctx, provider: new MockProvider() });
    expect(await release(releaseId)).toEqual(before);
  });

  it("generating a brief never changes Release.status", async () => {
    const { releaseId, statements } = await analysedSample();
    await reviewEverything(statements);
    const before = await release(releaseId);
    await brief(releaseId);
    expect(await release(releaseId)).toEqual(before);
  });

  it("the database refuses releases created as decided, and decisions without a recorded human", async () => {
    await expect(getDb().release.create({ data: { name: "x", product: "y", status: "APPROVED" } })).rejects.toThrow(/DRAFT/);
    const { releaseId } = await analysedSample();
    await expect(getDb().release.update({ where: { id: releaseId }, data: { status: "APPROVED" } })).rejects.toThrow(/decision must record/);
    await expect(
      getDb().release.update({ where: { id: releaseId }, data: { status: "REJECTED", decidedAt: new Date() } }),
    ).rejects.toThrow();
    expect((await release(releaseId)).status).toBe("DRAFT");
  });
});
