import { describe, expect, it } from "vitest";
import type { AnalysisOutput, SummariesOutput } from "@/lib/ai/output-schema";
import { indexItems, sanitizeAnalysis, sanitizeSummaries } from "@/lib/ai/sanitize";
import type { DraftStatement } from "@/lib/ai/types";
import { validPackage } from "../fixtures/release-package";

const index = indexItems(validPackage());
const emptyAnalysis: AnalysisOutput = { impactClassifications: [], missingInformation: [], unsupportedClaims: [], risks: [] };

describe("sanitizeAnalysis: citation safety", () => {
  it("keeps valid output and builds cited statements", () => {
    const { statements, dropped } = sanitizeAnalysis(
      {
        impactClassifications: [{ itemId: "CHG-1", impact: "high", userGroups: ["All signed-in users"], rationale: "Users are logged out sooner." }],
        missingInformation: [{ description: "No rollback plan for CHG-1.", relatedItemIds: ["CHG-1"] }],
        unsupportedClaims: [{ claimText: "No user impact", itemId: "CHG-1", reason: "QA-3 only checks expiry.", qaItemIds: ["QA-3"] }],
        risks: [{ description: "Users may lose unsaved work.", severity: "high", citations: ["CHG-1", "MIG-1"] }],
      },
      index,
    );
    expect(dropped).toEqual([]);
    expect(statements.map((s) => [s.kind, s.level, s.citations])).toEqual([
      ["IMPACT", "high", ["CHG-1"]],
      ["MISSING_INFO", null, ["CHG-1"]],
      ["UNSUPPORTED_CLAIM", null, ["CHG-1", "QA-3"]],
      ["RISK", "high", ["CHG-1", "MIG-1"]],
    ]);
    expect(statements[0].content).toContain("Session timeout reduced to 30 minutes");
  });

  it("drops hallucinated IDs from citations and reports them", () => {
    const { statements, dropped } = sanitizeAnalysis(
      { ...emptyAnalysis, risks: [{ description: "Risky.", severity: "medium", citations: ["FEAT-1", "FEAT-99", "QA-42"] }] },
      index,
    );
    expect(statements[0].citations).toEqual(["FEAT-1"]);
    expect(dropped).toEqual([expect.objectContaining({ kind: "RISK", reason: "invalid_citation", ids: ["FEAT-99", "QA-42"] })]);
  });

  it("drops risks that have no valid citation", () => {
    const { statements, dropped } = sanitizeAnalysis(
      {
        ...emptyAnalysis,
        risks: [
          { description: "Uncited risk.", severity: "low", citations: [] },
          { description: "Only invented IDs.", severity: "low", citations: ["FEAT-404"] },
        ],
      },
      index,
    );
    expect(statements).toEqual([]);
    expect(dropped.filter((d) => d.reason === "missing_citation")).toHaveLength(2);
  });

  it("rejects impact classifications for unknown or non-change items, and duplicates", () => {
    const { statements, dropped } = sanitizeAnalysis(
      {
        ...emptyAnalysis,
        impactClassifications: [
          { itemId: "FEAT-9", impact: "high", userGroups: [], rationale: "x" },
          { itemId: "QA-1", impact: "low", userGroups: [], rationale: "x" },
          { itemId: "FEAT-1", impact: "medium", userGroups: [], rationale: "x" },
          { itemId: "FEAT-1", impact: "high", userGroups: [], rationale: "y" },
        ],
      },
      index,
    );
    expect(statements.map((s) => s.citations)).toEqual([["FEAT-1"]]);
    expect(dropped.map((d) => d.reason)).toEqual(["unknown_item", "unknown_item", "duplicate"]);
  });

  it("only accepts QA items as QA evidence for unsupported claims, and requires a citation", () => {
    const { statements, dropped } = sanitizeAnalysis(
      {
        ...emptyAnalysis,
        unsupportedClaims: [
          { claimText: "Fully tested", itemId: "FEAT-1", reason: "r", qaItemIds: ["FIX-1", "QA-1"] },
          { claimText: "Zero risk", itemId: "FEAT-77", reason: "r", qaItemIds: [] },
        ],
      },
      index,
    );
    expect(statements).toHaveLength(1);
    expect(statements[0].citations).toEqual(["FEAT-1", "QA-1"]);
    expect(statements[0].metadata?.qaItemIds).toEqual(["QA-1"]);
    expect(dropped.map((d) => [d.reason, d.ids])).toEqual([
      ["invalid_citation", ["FIX-1"]],
      ["invalid_citation", ["FEAT-77"]],
      ["missing_citation", undefined],
    ]);
  });

  it("allows package-level missing information without citations", () => {
    const { statements } = sanitizeAnalysis(
      { ...emptyAnalysis, missingInformation: [{ description: "No rollout plan.", relatedItemIds: [] }] },
      index,
    );
    expect(statements).toEqual([expect.objectContaining({ kind: "MISSING_INFO", citations: [] })]);
  });

  it("does not duplicate findings already produced by deterministic rules", () => {
    const rule: DraftStatement = {
      kind: "UNSUPPORTED_CLAIM",
      source: "RULE",
      level: null,
      content: "rule",
      citations: ["FEAT-1"],
      metadata: { claimText: "Fully tested." },
    };
    const { statements, dropped } = sanitizeAnalysis(
      { ...emptyAnalysis, unsupportedClaims: [{ claimText: "Fully  tested.", itemId: "FEAT-1", reason: "r", qaItemIds: [] }] },
      index,
      [rule],
    );
    expect(statements).toEqual([]);
    expect(dropped[0].reason).toBe("duplicate");
  });
});

describe("sanitizeSummaries", () => {
  const summaries = (technicalSummary: SummariesOutput["technicalSummary"], nonTechnicalSummary: SummariesOutput["nonTechnicalSummary"] = []) =>
    sanitizeSummaries({ technicalSummary, nonTechnicalSummary }, index);

  it("keeps cited statements as separate TECH and NONTECH statements", () => {
    const { statements } = summaries(
      [{ content: "FEAT-1 adds CSV export.", citations: ["FEAT-1", "QA-1"] }],
      [{ content: "You can now export invoices.", citations: ["FEAT-1"] }],
    );
    expect(statements.map((s) => [s.kind, s.citations])).toEqual([
      ["TECH_SUMMARY", ["FEAT-1", "QA-1"]],
      ["NONTECH_SUMMARY", ["FEAT-1"]],
    ]);
  });

  it("requires at least one valid citation per summary statement", () => {
    const { statements, dropped } = summaries([
      { content: "Uncited.", citations: [] },
      { content: "Invented.", citations: ["FEAT-123"] },
    ]);
    expect(statements).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(["missing_citation", "invalid_citation", "missing_citation"]);
  });

  it("drops summary statements that assert unsupported absolute claims as fact", () => {
    const { statements, dropped } = summaries([
      { content: "The export is fully tested and has no performance impact.", citations: ["FEAT-1"] },
      { content: "Performance impact of the export has not been verified.", citations: ["FEAT-1"] },
    ]);
    expect(statements.map((s) => s.content)).toEqual(["Performance impact of the export has not been verified."]);
    expect(dropped).toEqual([expect.objectContaining({ reason: "unhedged_claim" })]);
  });
});
