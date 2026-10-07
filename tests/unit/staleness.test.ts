import { describe, expect, it } from "vitest";
import { diffVersions } from "@/lib/domain/diff-versions";
import { computeItemHashes } from "@/lib/domain/hash";
import { computeStaleness, relevantSections, type StatementForStaleness } from "@/lib/domain/staleness";
import type { ReleasePackage } from "@/lib/schema/release-package";
import { validPackage } from "../fixtures/release-package";

const v1 = validPackage();
const v1Hashes = computeItemHashes(v1);

/** Statement generated for v1, citing items with their v1 hashes. */
function statement(kind: StatementForStaleness["kind"], content: string, cited: string[], metadata?: Record<string, unknown>) {
  return { kind, content, citations: cited.map((itemId) => ({ itemId, itemHash: v1Hashes[itemId] })), metadata };
}

function check(s: StatementForStaleness, edit: (pkg: ReleasePackage) => void) {
  const v2 = validPackage();
  edit(v2);
  const to = { package: v2, itemHashes: computeItemHashes(v2) };
  return computeStaleness(s, { from: v1, to, diff: diffVersions({ package: v1, itemHashes: v1Hashes }, to) });
}

describe("staleness from citations", () => {
  const risk = statement("RISK", "Users may be logged out unexpectedly.", ["CHG-1"]);

  it("cited item modified → stale", () => {
    expect(check(risk, (p) => (p.changedBehaviour[0].title = "Timeout reduced to 15 minutes"))).toEqual({
      stale: true,
      reasons: ["CHG-1 was modified"],
    });
  });

  it("cited item removed → stale", () => {
    const r = check(statement("TECH_SUMMARY", "FIX-1 fixes receipt timezones.", ["FIX-1"]), (p) => {
      p.bugFixes = [];
      p.qaEvidence[1].coversItemIds = ["FEAT-1"];
    });
    expect(r.stale).toBe(true);
    expect(r.reasons).toContain("FIX-1 was removed");
  });

  it("cited item unchanged → not stale", () => {
    expect(check(risk, () => {})).toEqual({ stale: false, reasons: [] });
  });

  it("unrelated item modified → not stale", () => {
    expect(check(risk, (p) => (p.features[0].description += " Now also XLSX."))).toEqual({ stale: false, reasons: [] });
  });

  it("citation hash that doesn't match the target version → stale, even if the ID still exists", () => {
    const tampered = { ...risk, citations: [{ itemId: "CHG-1", itemHash: "0".repeat(64) }] };
    expect(check(tampered, () => {}).reasons).toEqual(["CHG-1 was modified"]);
  });
});

describe("staleness from QA evidence", () => {
  it("QA evidence for a cited change item changed → dependent statements stale, even if the item itself is unchanged", () => {
    const missing = statement("MISSING_INFO", "FEAT-1 is only partially verified (QA-1: partial).", ["FEAT-1"]);
    const r = check(missing, (p) =>
      p.qaEvidence.push({ id: "QA-4", title: "Full export run", result: "pass", coversItemIds: ["FEAT-1"], notes: "" }),
    );
    expect(r).toEqual({ stale: true, reasons: ["QA evidence for FEAT-1 changed"] });
  });

  it("a cited QA item whose result changed → stale (via its hash)", () => {
    const claim = statement("UNSUPPORTED_CLAIM", 'Unsupported claim in FEAT-1: "fully tested".', ["FEAT-1", "QA-1"]);
    expect(check(claim, (p) => (p.qaEvidence[0].result = "fail")).reasons).toEqual([
      "QA-1 was modified",
      "QA evidence for FEAT-1 changed",
    ]);
  });

  it("an impact statement only depends on QA when its text talks about verification", () => {
    const addQa = (p: ReleasePackage) =>
      p.qaEvidence.push({ id: "QA-4", title: "More tests", result: "pass", coversItemIds: ["FEAT-1"], notes: "" });
    expect(check(statement("IMPACT", "FEAT-1: medium impact for Billing admins.", ["FEAT-1"]), addQa).stale).toBe(false);
    expect(check(statement("IMPACT", "FEAT-1: medium impact. QA status: not verified.", ["FEAT-1"]), addQa).stale).toBe(true);
  });

  it("QA changes for other items do not affect the statement", () => {
    const s = statement("RISK", "FEAT-1 export could time out.", ["FEAT-1"]);
    expect(check(s, (p) => (p.qaEvidence[2].result = "fail")).stale).toBe(false);
  });
});

describe("section rules", () => {
  it("uncited summary + relevant section changed → stale", () => {
    const s = statement("TECH_SUMMARY", "All regression tests passed on staging.", []);
    expect(relevantSections(s)).toEqual(expect.arrayContaining(["qaEvidence", "qaSummary"]));
    expect(check(s, (p) => (p.qaSummary = "Two suites failed on staging."))).toEqual({
      stale: true,
      reasons: ["QA summary changed"],
    });
  });

  it("uncited summary + unrelated section changed → not stale", () => {
    const s = statement("TECH_SUMMARY", "All regression tests passed on staging.", []);
    expect(check(s, (p) => (p.knownLimitations[0].text = "Exports above 5,000 rows are truncated.")).stale).toBe(false);
  });

  it("uncited statement naming no section is stale when any content changes (conservative)", () => {
    const s = statement("NONTECH_SUMMARY", "Several improvements ship this month.", []);
    expect(check(s, (p) => (p.knownLimitations[0].text = "Changed.")).reasons).toEqual([
      "Known limitations changed (LIM-1 modified)",
    ]);
  });

  it("missing-information + relevant section changed → stale (gap may be filled)", () => {
    const s = statement("MISSING_INFO", "No rollback plan is described for breaking change CHG-1.", ["CHG-1"]);
    const r = check(s, (p) => p.migrationNotes.push({ id: "MIG-2", text: "Rollback: set SESSION_TIMEOUT_MINUTES=480." }));
    expect(r).toEqual({ stale: true, reasons: ["Migration notes changed (MIG-2 added)"] });
  });

  it("cited missing-information is not stale when an unrelated section changes", () => {
    const s = statement("MISSING_INFO", "No rollback plan is described for breaking change CHG-1.", ["CHG-1"]);
    expect(check(s, (p) => (p.features[0].title = "Bulk export v2")).stale).toBe(false);
    // QA keywords don't make cited gaps stale on unrelated QA changes; the QA-dependency rule is precise.
    const qaGap = statement("MISSING_INFO", "CHG-1 has no QA evidence.", ["CHG-1"]);
    expect(check(qaGap, (p) => (p.qaEvidence[0].notes = "Re-run on rc2")).stale).toBe(false);
  });

  it("generated for the same version → never stale", () => {
    const s = statement("RISK", "Anything", ["CHG-1"]);
    expect(check(s, () => {}).stale).toBe(false);
  });
});
