import { describe, expect, it } from "vitest";
import { runPrecheck } from "@/lib/ai/precheck";
import { containsUnhedgedClaim, findAbsoluteClaims } from "@/lib/domain/claims";
import { qaCoverage } from "@/lib/domain/qa-coverage";
import { validPackage } from "../fixtures/release-package";

describe("qaCoverage", () => {
  it("classifies verified, partial, not-passed and uncovered items", () => {
    const pkg = validPackage();
    pkg.qaEvidence[1].result = "partial"; // FIX-1
    pkg.qaEvidence[2].result = "not_run"; // CHG-1
    pkg.features.push({ id: "FEAT-2", title: "Untested", description: "A feature with no QA evidence at all.", userGroups: [] });
    const status = Object.fromEntries(qaCoverage(pkg).map((c) => [c.itemId, c.status]));
    expect(status).toEqual({ "FEAT-1": "verified", "FEAT-2": "uncovered", "FIX-1": "partial", "CHG-1": "not_passed" });
  });

  it("treats an item as verified if any covering QA passed", () => {
    const pkg = validPackage();
    pkg.qaEvidence.push({ id: "QA-4", title: "Flaky", result: "fail", coversItemIds: ["FEAT-1"], notes: "" });
    expect(qaCoverage(pkg).find((c) => c.itemId === "FEAT-1")?.status).toBe("verified");
  });
});

describe("absolute claim detection", () => {
  it.each([
    "Fully tested across all browsers.",
    "There is no performance impact.",
    "All users are unaffected by this change.",
    "Zero downtime migration.",
    "This is fully backward-compatible.",
  ])("detects %s", (text) => {
    expect(findAbsoluteClaims(text)).toHaveLength(1);
    expect(containsUnhedgedClaim(text)).toBe(true);
  });

  it("does not flag hedged or reported claims", () => {
    expect(containsUnhedgedClaim('The change is described as "fully tested", but no QA evidence supports this.')).toBe(false);
    expect(containsUnhedgedClaim("Performance impact has not been verified.")).toBe(false);
    expect(findAbsoluteClaims("Exports run in the background.")).toEqual([]);
  });
});

describe("runPrecheck", () => {
  it("produces no rule statements for a complete, fully verified package", () => {
    const result = runPrecheck(validPackage());
    expect(result.validation.valid).toBe(true);
    expect(result.ruleStatements).toEqual([]);
  });

  it("reports blocking validation errors", () => {
    const result = runPrecheck({ ...validPackage(), qaSummary: "" });
    expect(result.validation.valid).toBe(false);
  });

  it("turns coverage gaps and thin descriptions into cited MISSING_INFO rule statements", () => {
    const pkg = validPackage();
    pkg.qaEvidence = pkg.qaEvidence.filter((qa) => qa.id !== "QA-1"); // FEAT-1 uncovered
    pkg.qaEvidence[0].result = "not_run"; // FIX-1 only not-run QA
    pkg.changedBehaviour[0].description = "Shorter.";
    const rules = runPrecheck(pkg).ruleStatements;

    expect(rules.map((r) => [r.kind, r.source, r.metadata?.rule, r.citations])).toEqual([
      ["MISSING_INFO", "RULE", "QA_UNCOVERED", ["FEAT-1"]],
      ["MISSING_INFO", "RULE", "QA_NOT_PASSED", ["FIX-1", "QA-2"]],
      ["MISSING_INFO", "RULE", "THIN_DESCRIPTION", ["CHG-1"]],
    ]);
  });

  it("flags absolute claims in items without passing QA as unsupported, citing the item and its QA", () => {
    const pkg = validPackage();
    pkg.features[0].description += " Fully tested on every browser.";
    pkg.qaEvidence[0].result = "partial";
    const result = runPrecheck(pkg);

    const claim = result.ruleStatements.find((s) => s.kind === "UNSUPPORTED_CLAIM");
    expect(claim).toMatchObject({
      source: "RULE",
      citations: ["FEAT-1", "QA-1"],
      metadata: { claimText: "Fully tested on every browser.", itemId: "FEAT-1", qaItemIds: ["QA-1"] },
    });
    expect(String(claim?.metadata?.reason)).toContain("did not fully pass");
  });

  it("leaves claims on verified items to the model as candidates, not rule findings", () => {
    const pkg = validPackage();
    pkg.features[0].description += " No performance impact on the dashboard.";
    const result = runPrecheck(pkg);
    expect(result.claimCandidates).toEqual([
      expect.objectContaining({ itemId: "FEAT-1", phrase: "No performance impact", coverage: "verified" }),
    ]);
    expect(result.ruleStatements.filter((s) => s.kind === "UNSUPPORTED_CLAIM")).toEqual([]);
  });

  it("collects claims in the QA summary as candidates", () => {
    const pkg = { ...validPackage(), qaSummary: "Everything is fully tested." };
    expect(runPrecheck(pkg).claimCandidates).toEqual([
      expect.objectContaining({ itemId: null, location: "qaSummary", phrase: "fully tested" }),
    ]);
  });
});
