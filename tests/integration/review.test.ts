import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/statements/[statementId]/route";
import { MockProvider } from "@/lib/ai/mock-provider";
import { runAnalysis } from "@/lib/ai/run-analysis";
import { getDb } from "@/lib/db";
import { summarizeReview } from "@/lib/domain/review";
import { getVersionAnalysis } from "@/lib/services/analysis";
import { createSampleRelease, getVersion } from "@/lib/services/releases";
import { ctx, jsonRequest, params, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => getDb().$disconnect());

async function analysedSample() {
  const release = await createSampleRelease(ctx);
  const { runId } = await runAnalysis(release.id, 2, { ...ctx, provider: new MockProvider() });
  const statements = await getDb().generatedStatement.findMany({ where: { runId }, orderBy: { order: "asc" } });
  return { release, runId, statements };
}

async function review(statementId: string, body: unknown) {
  const res = await PATCH(jsonRequest(`/api/statements/${statementId}`, body, "PATCH"), params({ statementId }));
  return { status: res.status, body: await res.json() };
}

const row = (id: string) => getDb().generatedStatement.findUniqueOrThrow({ where: { id } });

describe("PATCH /api/statements/:id", () => {
  it("approves a statement and records the reviewer", async () => {
    const { statements } = await analysedSample();
    const res = await review(statements[0].id, { action: "approve", reviewer: "Ada Lovelace" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ reviewStatus: "APPROVED", reviewedBy: "Ada Lovelace", editedContent: null });
    const saved = await row(statements[0].id);
    expect(saved.reviewStatus).toBe("APPROVED");
    expect(saved.reviewedAt).toBeInstanceOf(Date);
  });

  it("rejects a statement with an optional note", async () => {
    const { statements } = await analysedSample();
    const res = await review(statements[1].id, { action: "reject", reviewer: "Ada", note: "Duplicate of FEAT-1 entry" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ reviewStatus: "REJECTED", reviewNote: "Duplicate of FEAT-1 entry" });
  });

  it("edits a statement, keeping the original generated content", async () => {
    const { statements } = await analysedSample();
    const original = statements[2];
    const res = await review(original.id, { action: "edit", reviewer: "Ada", content: "Reworded by a human." });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      reviewStatus: "EDITED",
      content: "Reworded by a human.",
      editedContent: "Reworded by a human.",
      aiContent: original.aiContent,
    });
    const saved = await row(original.id);
    expect(saved.aiContent).toBe(original.aiContent);
    expect(saved.citations).toEqual(original.citations);
  });

  it.each([
    [{ action: "edit", reviewer: "Ada", content: "   " }, "content"],
    [{ action: "approve" }, "reviewer"],
    [{ action: "reject", reviewer: "" }, "reviewer"],
    [{ action: "publish", reviewer: "Ada" }, "action"],
  ])("rejects invalid request %j with 400", async (body, field) => {
    const { statements } = await analysedSample();
    const res = await review(statements[0].id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe(field);
    expect((await row(statements[0].id)).reviewStatus).toBe("PENDING");
  });

  it("returns 404 for an unknown statement and 422 for an unchanged edit", async () => {
    const { statements } = await analysedSample();
    expect((await review("missing", { action: "approve", reviewer: "Ada" })).status).toBe(404);
    const unchanged = await review(statements[0].id, { action: "edit", reviewer: "Ada", content: statements[0].aiContent });
    expect(unchanged.status).toBe(422);
    expect(unchanged.body.error.code).toBe("NO_CHANGES");
  });
});

describe("review transitions", () => {
  it("rejected → edit → approve, keeping the edit and the original", async () => {
    const { statements } = await analysedSample();
    const id = statements[3].id;
    expect((await review(id, { action: "reject", reviewer: "Ada", note: "Too vague" })).body.data.reviewStatus).toBe("REJECTED");
    const edited = await review(id, { action: "edit", reviewer: "Grace", content: "Clearer wording." });
    expect(edited.body.data).toMatchObject({ reviewStatus: "EDITED", reviewNote: null, reviewedBy: "Grace" });
    const approved = await review(id, { action: "approve", reviewer: "Grace" });
    expect(approved.body.data).toMatchObject({ reviewStatus: "APPROVED", content: "Clearer wording.", aiContent: statements[3].aiContent });
  });

  it("approved → edit (edit again) and approved → reject", async () => {
    const { statements } = await analysedSample();
    const [a, b] = statements;
    await review(a.id, { action: "approve", reviewer: "Ada" });
    expect((await review(a.id, { action: "edit", reviewer: "Ada", content: "v1" })).body.data.reviewStatus).toBe("EDITED");
    expect((await review(a.id, { action: "edit", reviewer: "Ada", content: "v2" })).body.data.content).toBe("v2");
    await review(b.id, { action: "approve", reviewer: "Ada" });
    expect((await review(b.id, { action: "reject", reviewer: "Ada" })).body.data.reviewStatus).toBe("REJECTED");
  });

  it("refuses no-op transitions with 409", async () => {
    const { statements } = await analysedSample();
    await review(statements[0].id, { action: "approve", reviewer: "Ada" });
    expect((await review(statements[0].id, { action: "approve", reviewer: "Ada" })).status).toBe(409);
    await review(statements[1].id, { action: "reject", reviewer: "Ada" });
    expect((await review(statements[1].id, { action: "reject", reviewer: "Ada" })).status).toBe(409);
  });

  it("refuses to review statements of a superseded analysis run", async () => {
    const { release, statements } = await analysedSample();
    await runAnalysis(release.id, 2, { ...ctx, provider: new MockProvider() });
    const res = await review(statements[0].id, { action: "approve", reviewer: "Ada" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/superseded/);
  });
});

describe("audit log and side effects", () => {
  it("logs every review action with statement, version, release, action, reviewer, timestamp and requestId", async () => {
    const { release, statements } = await analysedSample();
    const id = statements[0].id;
    await review(id, { action: "edit", reviewer: "Ada", content: "Edited." });
    await review(id, { action: "approve", reviewer: "Grace" });
    await review(id, { action: "reject", reviewer: "Linus", note: "Changed my mind" });

    const logs = await getDb().appLog.findMany({ where: { event: "statement.reviewed" }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(3);
    const version = await getVersion(release.id, 2);
    for (const log of logs) {
      expect(log.releaseId).toBe(release.id);
      expect(log.requestId).toEqual(expect.any(String));
      expect(log.context).toMatchObject({
        statementId: id,
        versionId: version!.id,
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }
    expect(logs.map((l) => l.context)).toEqual([
      expect.objectContaining({ action: "edit", reviewer: "Ada", fromStatus: "PENDING", toStatus: "EDITED" }),
      expect.objectContaining({ action: "approve", reviewer: "Grace", fromStatus: "EDITED", toStatus: "APPROVED" }),
      expect.objectContaining({ action: "reject", reviewer: "Linus", fromStatus: "APPROVED", toStatus: "REJECTED", hasNote: true }),
    ]);
    // Edited text itself is not logged.
    expect(JSON.stringify(logs.map((l) => l.context))).not.toContain("Edited.");
  });

  it("never changes Release.status", async () => {
    const { release, statements } = await analysedSample();
    const before = await getDb().release.findUniqueOrThrow({ where: { id: release.id } });
    for (const statement of statements) await review(statement.id, { action: "approve", reviewer: "Ada" });
    const after = await getDb().release.findUniqueOrThrow({ where: { id: release.id } });
    expect(after).toEqual(before);
    expect(after.status).toBe("DRAFT");
  });

  it("review counts reflect the actions taken", async () => {
    const { release, statements } = await analysedSample();
    await review(statements[0].id, { action: "approve", reviewer: "Ada" });
    await review(statements[1].id, { action: "approve", reviewer: "Ada" });
    await review(statements[2].id, { action: "edit", reviewer: "Ada", content: "x" });
    await review(statements[3].id, { action: "reject", reviewer: "Ada" });
    const version = await getVersion(release.id, 2);
    const summary = summarizeReview((await getVersionAnalysis(version!.id)).statements);
    expect(summary).toMatchObject({
      total: statements.length,
      approved: 2,
      edited: 1,
      rejected: 1,
      pending: statements.length - 4,
      allReviewed: false,
    });
  });
});

describe("database guarantees", () => {
  it("analysis always creates PENDING statements", async () => {
    const { statements } = await analysedSample();
    expect(statements.every((s) => s.reviewStatus === "PENDING" && !s.reviewedBy && !s.editedContent)).toBe(true);
  });

  it("no code path can insert an already-reviewed statement", async () => {
    const { statements } = await analysedSample();
    const template = statements[0];
    await expect(
      getDb().generatedStatement.create({
        data: {
          runId: template.runId,
          versionId: template.versionId,
          kind: template.kind,
          source: template.source,
          aiContent: template.aiContent,
          citations: template.citations as object,
          order: 999,
          reviewStatus: "APPROVED",
          reviewedBy: "AI",
          reviewedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/must be created as PENDING/);
  });

  it("generated content cannot be overwritten, and a reviewed status requires a reviewer", async () => {
    const { statements } = await analysedSample();
    const id = statements[0].id;
    await expect(getDb().generatedStatement.update({ where: { id }, data: { aiContent: "rewritten" } })).rejects.toThrow(
      /immutable/,
    );
    await expect(getDb().generatedStatement.update({ where: { id }, data: { reviewStatus: "APPROVED" } })).rejects.toThrow();
    expect((await row(id)).reviewStatus).toBe("PENDING");
  });
});
