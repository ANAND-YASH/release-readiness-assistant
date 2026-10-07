import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAnalysisRoute } from "@/app/api/releases/[releaseId]/versions/[versionNumber]/analysis/route";
import { POST as analyzeRoute } from "@/app/api/releases/[releaseId]/versions/[versionNumber]/analyze/route";
import { MockProvider } from "@/lib/ai/mock-provider";
import { AiProviderError, type AIProvider, type AiRequest } from "@/lib/ai/provider";
import { runAnalysis } from "@/lib/ai/run-analysis";
import { getDb } from "@/lib/db";
import { computeItemHashes, hashPackage } from "@/lib/domain/hash";
import { ApiError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createSampleRelease, getVersion } from "@/lib/services/releases";
import { validPackage } from "../fixtures/release-package";
import { ctx, jsonRequest, params, resetDb } from "./helpers";

const openai = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    constructor() {
      openai.constructed();
    }
  },
}));

/** Provider that returns scripted raw outputs per call, falling back to the mock provider. */
function scriptedProvider(script: (string | Error | undefined)[]): AIProvider & { requests: AiRequest[] } {
  const fallback = new MockProvider();
  const requests: AiRequest[] = [];
  return {
    name: "scripted",
    model: "scripted-v1",
    requests,
    async generate(request) {
      requests.push(request);
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "string") return { rawText: next, model: "scripted-v1", usage: { promptTokens: 10, completionTokens: 5 } };
      return fallback.generate(request);
    },
  };
}

async function sampleV2() {
  const release = await createSampleRelease(ctx);
  const version = (await getVersion(release.id, 2))!;
  return { release, version };
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status, code });
  return err as ApiError;
}

beforeEach(async () => {
  await resetDb();
  openai.constructed.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => getDb().$disconnect());

describe("runAnalysis with the mock provider", () => {
  it("persists cited statements as PENDING and records a SUCCEEDED run", async () => {
    const { release, version } = await sampleV2();
    const releaseBefore = await getDb().release.findUniqueOrThrow({ where: { id: release.id } });

    const outcome = await runAnalysis(release.id, 2, { ...ctx, provider: new MockProvider() });

    const run = await getDb().analysisRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run).toMatchObject({
      status: "SUCCEEDED",
      provider: "mock",
      model: "mock-v1",
      promptVersion: "analysis.v1+summaries.v1",
      attempts: 2,
      error: null,
      versionId: version.id,
    });
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.latencyMs).toEqual(expect.any(Number));

    const statements = await getDb().generatedStatement.findMany({ where: { runId: run.id }, orderBy: { order: "asc" } });
    expect(statements.length).toBe(outcome.statementCount);
    expect(new Set(statements.map((s) => s.kind))).toEqual(
      new Set(["IMPACT", "MISSING_INFO", "UNSUPPORTED_CLAIM", "RISK", "TECH_SUMMARY", "NONTECH_SUMMARY"]),
    );
    expect(statements.every((s) => s.reviewStatus === "PENDING" && s.reviewedAt === null)).toBe(true);
    expect(statements.map((s) => s.order)).toEqual(statements.map((_, i) => i));

    // Every citation references a real item of this version, with that version's hash.
    for (const statement of statements) {
      for (const citation of statement.citations as { itemId: string; itemHash: string }[]) {
        expect(version.itemHashes[citation.itemId]).toBe(citation.itemHash);
      }
      if (["RISK", "TECH_SUMMARY", "NONTECH_SUMMARY", "UNSUPPORTED_CLAIM", "IMPACT"].includes(statement.kind)) {
        expect((statement.citations as unknown[]).length).toBeGreaterThan(0);
      }
    }

    // Both kinds of unsupported claim: deterministic (CHG-2) and model (FEAT-1).
    const claims = statements.filter((s) => s.kind === "UNSUPPORTED_CLAIM");
    expect(claims.map((c) => [c.source, (c.metadata as { itemId: string }).itemId])).toEqual([
      ["RULE", "CHG-2"],
      ["AI", "FEAT-1"],
    ]);

    // AI never changes the release.
    const releaseAfter = await getDb().release.findUniqueOrThrow({ where: { id: release.id } });
    expect(releaseAfter).toEqual(releaseBefore);
    expect(releaseAfter.status).toBe("DRAFT");

    const events = (await getDb().appLog.findMany({ where: { releaseId: release.id }, orderBy: { createdAt: "asc" } }))
      .map((l) => l.event)
      .filter((e) => e.startsWith("analysis."));
    expect(events).toEqual([
      "analysis.started",
      "analysis.llm_attempt",
      "analysis.output_validated",
      "analysis.llm_attempt",
      "analysis.output_validated",
      "analysis.completed",
    ]);
  });

  it("does not change an already-set release status", async () => {
    const { release } = await sampleV2();
    await getDb().release.update({ where: { id: release.id }, data: { status: "IN_REVIEW" } });
    await runAnalysis(release.id, 2, { ...ctx, provider: new MockProvider() });
    expect((await getDb().release.findUniqueOrThrow({ where: { id: release.id } })).status).toBe("IN_REVIEW");
  });

  it("never constructs the OpenAI client when AI_PROVIDER=mock", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("OPENAI_API_KEY", "sk-should-not-be-used");
    const { release } = await sampleV2();
    const outcome = await runAnalysis(release.id, 2, ctx); // provider from the factory
    expect(outcome.statementCount).toBeGreaterThan(0);
    expect(openai.constructed).not.toHaveBeenCalled();
  });
});

describe("runAnalysis validation and retries", () => {
  it("retries exactly once with the parse error, then succeeds", async () => {
    const { release } = await sampleV2();
    const provider = scriptedProvider(["this is not json"]);
    const outcome = await runAnalysis(release.id, 2, { ...ctx, provider });

    expect(provider.requests).toHaveLength(3); // analysis ×2, summaries ×1
    expect(provider.requests[0].retry).toBeUndefined();
    expect(provider.requests[1].retry).toEqual({
      previousOutput: "this is not json",
      error: expect.stringContaining("not valid JSON"),
    });
    const run = await getDb().analysisRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.attempts).toBe(3);
    expect(run.promptTokens).toBe(10); // only the scripted attempt reported usage
  });

  it("marks the run FAILED after a second invalid output, keeps raw output and persists no statements", async () => {
    const { release } = await sampleV2();
    const wrongShape = JSON.stringify({ impactClassifications: "nope" });
    const provider = scriptedProvider(["{broken", wrongShape]);

    const err = await expectApiError(runAnalysis(release.id, 2, { ...ctx, provider }), 502, "ANALYSIS_FAILED");
    const runId = (err.details as { runId: string }).runId;
    const run = await getDb().analysisRun.findUniqueOrThrow({ where: { id: runId } });

    expect(run.status).toBe("FAILED");
    expect(run.attempts).toBe(2);
    expect(run.error).toContain("analysis: Output does not match the schema");
    const raw = run.rawOutput as { attempts: { rawText: string; outcome: string }[] };
    expect(raw.attempts.map((a) => [a.rawText, a.outcome])).toEqual([
      ["{broken", "invalid"],
      [wrongShape, "invalid"],
    ]);
    expect(await getDb().generatedStatement.count()).toBe(0);
    expect(provider.requests).toHaveLength(2); // summaries never called

    const events = (await getDb().appLog.findMany({ where: { releaseId: release.id } })).map((l) => l.event);
    expect(events).toContain("analysis.retry");
    expect(events).toContain("analysis.failed");
  });

  it("fails summaries the same way, without persisting analysis statements", async () => {
    const { release } = await sampleV2();
    const provider = scriptedProvider([undefined, "[]", "[]"]);
    await expectApiError(runAnalysis(release.id, 2, { ...ctx, provider }), 502, "ANALYSIS_FAILED");
    expect(provider.requests.map((r) => r.task.name)).toEqual(["analysis", "summaries", "summaries"]);
    expect(await getDb().generatedStatement.count()).toBe(0);
  });

  it("does not retry provider errors; the run is FAILED", async () => {
    const { release } = await sampleV2();
    const provider = scriptedProvider([new AiProviderError("OpenAI request failed (HTTP 429)")]);
    const err = await expectApiError(runAnalysis(release.id, 2, { ...ctx, provider }), 502, "ANALYSIS_FAILED");
    expect(err.message).toContain("HTTP 429");
    expect(provider.requests).toHaveLength(1);
    expect((await getDb().analysisRun.findFirstOrThrow()).status).toBe("FAILED");
    const attempt = await getDb().appLog.findFirstOrThrow({ where: { event: "analysis.llm_attempt" } });
    expect(attempt).toMatchObject({ level: "ERROR", context: expect.objectContaining({ outcome: "provider_error" }) });
  });

  it("drops hallucinated citations and statements before they reach the database, and logs it", async () => {
    const { release, version } = await sampleV2();
    const analysis = JSON.stringify({
      impactClassifications: [
        { itemId: "FEAT-1", impact: "medium", userGroups: ["Billing admins"], rationale: "New export." },
        { itemId: "FEAT-42", impact: "high", userGroups: [], rationale: "Invented item." },
      ],
      missingInformation: [],
      unsupportedClaims: [],
      risks: [
        { description: "Export may time out.", severity: "medium", citations: ["FEAT-1", "QA-99"] },
        { description: "Invented risk.", severity: "high", citations: ["FIX-77"] },
      ],
    });
    const summaries = JSON.stringify({
      technicalSummary: [
        { content: "FEAT-1 raises the export limit.", citations: ["FEAT-1"] },
        { content: "Ungrounded statement.", citations: [] },
      ],
      nonTechnicalSummary: [{ content: "Exports are fully tested and have zero risk.", citations: ["FEAT-1"] }],
    });
    const outcome = await runAnalysis(release.id, 2, { ...ctx, provider: scriptedProvider([analysis, summaries]) });

    const statements = await getDb().generatedStatement.findMany({ where: { runId: outcome.runId, source: "AI" } });
    const allCited = statements.flatMap((s) => (s.citations as { itemId: string }[]).map((c) => c.itemId));
    expect(allCited.every((id) => id in version.itemHashes)).toBe(true);
    expect(statements.map((s) => s.kind).sort()).toEqual(["IMPACT", "RISK", "TECH_SUMMARY"]);
    // FEAT-42 impact (unknown item), QA-99 + FIX-77 (invalid citations), the FIX-77-only risk and the
    // uncited summary (missing citation), and the "fully tested / zero risk" summary (unhedged claim).
    expect(outcome.droppedCount).toBe(6);

    const log = await getDb().appLog.findFirstOrThrow({ where: { event: "analysis.invalid_citations_dropped" } });
    expect(log.context).toMatchObject({
      runId: outcome.runId,
      count: 6,
      byReason: { unknown_item: 1, invalid_citation: 2, missing_citation: 2, unhedged_claim: 1 },
    });
    expect((log.context as { invalidIds: string[] }).invalidIds.sort()).toEqual(["FEAT-42", "FIX-77", "QA-99"]);
  });
});

describe("pre-check", () => {
  it("blocks analysis of a version with blocking validation errors and creates no run", async () => {
    // Saving rejects invalid packages, so insert a legacy-style invalid version directly.
    const pkg = { ...validPackage(), qaSummary: "" };
    const release = await getDb().release.create({
      data: {
        name: "Legacy",
        product: "Legacy",
        versions: {
          create: {
            versionNumber: 1,
            package: pkg as unknown as Prisma.InputJsonObject,
            itemHashes: computeItemHashes(pkg),
            packageHash: hashPackage(pkg),
            validation: { valid: true, errors: [], warnings: [] },
          },
        },
      },
    });

    const err = await expectApiError(runAnalysis(release.id, 1, { ...ctx, provider: new MockProvider() }), 422, "ANALYSIS_BLOCKED");
    expect((err.details as { errors: { code: string }[] }).errors.map((e) => e.code)).toEqual(["QA_SUMMARY_MISSING"]);
    expect(await getDb().analysisRun.count()).toBe(0);
    expect(await getDb().appLog.count({ where: { event: "analysis.precheck_failed" } })).toBe(1);
  });
});

describe("analysis routes", () => {
  it("POST analyze returns PENDING statements; GET analysis returns the latest run", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { release } = await sampleV2();
    const p = params({ releaseId: release.id, versionNumber: "2" });

    const res = await analyzeRoute(jsonRequest(`/api/releases/${release.id}/versions/2/analyze`), p);
    expect(res.status).toBe(201);
    const body = (await res.json()).data;
    expect(body.latestRun.status).toBe("SUCCEEDED");
    expect(body.statements.length).toBe(body.statementCount);
    expect(body.statements.every((s: { reviewStatus: string }) => s.reviewStatus === "PENDING")).toBe(true);

    const get = await getAnalysisRoute(new Request("http://test"), p);
    expect((await get.json()).data.statementsRun.id).toBe(body.runId);

    const missing = await analyzeRoute(jsonRequest("/x"), params({ releaseId: release.id, versionNumber: "9" }));
    expect(missing.status).toBe(404);
  });

  it("returns 503 when AI_PROVIDER=openai has no key, without creating a run", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    const { release } = await sampleV2();
    const res = await analyzeRoute(jsonRequest("/x"), params({ releaseId: release.id, versionNumber: "2" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("sk-");
    expect(await getDb().analysisRun.count()).toBe(0);
  });
});
