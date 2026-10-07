import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai/factory";
import { buildAnalysisInput, buildSummariesInput } from "@/lib/ai/input";
import { MockProvider, mockAnalysis } from "@/lib/ai/mock-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { AnalysisOutputSchema, SummariesOutputSchema } from "@/lib/ai/output-schema";
import { runPrecheck } from "@/lib/ai/precheck";
import { AiProviderError } from "@/lib/ai/provider";
import { indexItems, sanitizeAnalysis, sanitizeSummaries } from "@/lib/ai/sanitize";
import { ApiError } from "@/lib/errors";
import { SAMPLE_V2 } from "@/lib/sample-data";
import { ReleasePackageSchema } from "@/lib/schema/release-package";

const openai = vi.hoisted(() => ({ constructed: vi.fn(), create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openai.create } };
    constructor(options: unknown) {
      openai.constructed(options);
    }
  },
}));

const pkg = ReleasePackageSchema.parse(SAMPLE_V2);
const precheck = runPrecheck(pkg);
const input = buildAnalysisInput({ name: "Billing Portal 4.2", product: "Billing Portal" }, 2, pkg, precheck);

beforeEach(() => {
  openai.constructed.mockReset();
  openai.create.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("MockProvider", () => {
  const provider = new MockProvider();
  const request = { system: "s", user: "u", schemaName: "x", schema: z.unknown() };

  it("returns schema-valid, deterministic analysis for the sample release", async () => {
    const first = await provider.generate({ ...request, task: { name: "analysis", input } });
    const second = await provider.generate({ ...request, task: { name: "analysis", input } });
    expect(first.rawText).toBe(second.rawText);

    const output = AnalysisOutputSchema.parse(JSON.parse(first.rawText));
    expect(new Set(output.impactClassifications.map((c) => c.impact))).toEqual(new Set(["high", "medium", "low"]));
    expect(output.missingInformation.length).toBeGreaterThan(0);
    expect(output.unsupportedClaims).toEqual([
      expect.objectContaining({ itemId: "FEAT-1", qaItemIds: ["QA-1"], claimText: "No performance impact on the Invoices page." }),
    ]);
    expect(output.risks.length).toBeGreaterThan(0);
  });

  it("produces only valid citations (nothing dropped by the sanitizer)", async () => {
    const index = indexItems(pkg);
    const analysis = sanitizeAnalysis(mockAnalysis(input), index, precheck.ruleStatements);
    const summariesInput = buildSummariesInput(input, [...precheck.ruleStatements, ...analysis.statements]);
    const raw = await provider.generate({ ...request, task: { name: "summaries", input: summariesInput } });
    const summaries = sanitizeSummaries(SummariesOutputSchema.parse(JSON.parse(raw.rawText)), index);

    expect(analysis.dropped).toEqual([]);
    expect(summaries.dropped).toEqual([]);
    const kinds = summaries.statements.map((s) => s.kind);
    expect(kinds).toContain("TECH_SUMMARY");
    expect(kinds).toContain("NONTECH_SUMMARY");
  });
});

describe("getAIProvider", () => {
  it("defaults to the mock provider and never touches the OpenAI SDK", () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(getAIProvider().name).toBe("mock");
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(getAIProvider().name).toBe("mock");
    expect(openai.constructed).not.toHaveBeenCalled();
  });

  it("requires an API key for openai", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => getAIProvider()).toThrow(ApiError);
  });

  it("rejects unknown providers", () => {
    vi.stubEnv("AI_PROVIDER", "llama");
    expect(() => getAIProvider()).toThrow(/Unknown AI_PROVIDER/);
  });

  it("builds the OpenAI provider with the configured model", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.model).toBe("gpt-test");
    expect(openai.constructed).not.toHaveBeenCalled(); // client is created lazily
  });
});

describe("OpenAIProvider", () => {
  const request = {
    task: { name: "analysis" as const, input },
    system: "system prompt",
    user: "user prompt",
    schemaName: "release_analysis",
    schema: AnalysisOutputSchema,
  };

  it("sends a strict json_schema response format and maps usage", async () => {
    openai.create.mockResolvedValue({
      model: "gpt-test-2026",
      choices: [{ message: { content: '{"ok":true}', refusal: null } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    });
    const response = await new OpenAIProvider("sk-test", "gpt-test").generate(request);

    expect(response).toEqual({ rawText: '{"ok":true}', model: "gpt-test-2026", usage: { promptTokens: 120, completionTokens: 30 } });
    const body = openai.create.mock.calls[0][0];
    expect(body.model).toBe("gpt-test");
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toMatchObject({ name: "release_analysis", strict: true });
    expect(body.response_format.json_schema.schema.required).toEqual([
      "impactClassifications",
      "missingInformation",
      "unsupportedClaims",
      "risks",
    ]);
    expect(openai.constructed).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-test" }));
  });

  it("includes the rejected output and validation error on retry", async () => {
    openai.create.mockResolvedValue({ model: "m", choices: [{ message: { content: "{}" } }] });
    await new OpenAIProvider("sk-test").generate({ ...request, retry: { previousOutput: "{bad", error: "Output is not valid JSON" } });
    const messages = openai.create.mock.calls[0][0].messages;
    expect(messages.slice(2)).toEqual([
      { role: "assistant", content: "{bad" },
      expect.objectContaining({ role: "user", content: expect.stringContaining("Output is not valid JSON") }),
    ]);
  });

  it("wraps API failures and refusals in AiProviderError without leaking the key", async () => {
    openai.create.mockRejectedValueOnce(Object.assign(new Error("401 Incorrect API key provided: sk-test"), { status: 401 }));
    const failure = await new OpenAIProvider("sk-test").generate(request).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as Error).message).toBe("OpenAI request failed (HTTP 401)");

    openai.create.mockResolvedValueOnce({ model: "m", choices: [{ message: { content: null, refusal: "I can't help" } }] });
    await expect(new OpenAIProvider("sk-test").generate(request)).rejects.toThrow(/refused/);
  });
});
