import { describe, expect, it } from "vitest";
import { diffVersions } from "@/lib/domain/diff-versions";
import { computeItemHashes } from "@/lib/domain/hash";
import type { ReleasePackage } from "@/lib/schema/release-package";
import { validPackage } from "../fixtures/release-package";

const snap = (pkg: ReleasePackage) => ({ package: pkg, itemHashes: computeItemHashes(pkg) });
const diff = (a: ReleasePackage, b: ReleasePackage) => diffVersions(snap(a), snap(b));
const byId = (d: ReturnType<typeof diff>) => Object.fromEntries(d.items.map((i) => [i.id, i]));

describe("diffVersions: items", () => {
  it("reports an identical package as all unchanged", () => {
    const d = diff(validPackage(), validPackage());
    expect(d.counts).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 8 });
    expect(d.scalars).toEqual([]);
    expect(d.changedSections).toEqual([]);
  });

  it("classifies added, removed, modified and unchanged items by stable ID", () => {
    const before = validPackage();
    const after = validPackage();
    after.features.push({ id: "FEAT-2", title: "Audit export", description: "Admins can export the audit log.", userGroups: [] });
    after.bugFixes = [];
    after.qaEvidence = after.qaEvidence.filter((qa) => qa.id !== "QA-2");
    after.changedBehaviour[0].title = "Session timeout reduced to 15 minutes";

    const items = byId(diff(before, after));
    expect(items["FEAT-2"].change).toBe("added");
    expect(items["FIX-1"].change).toBe("removed");
    expect(items["QA-2"].change).toBe("removed");
    expect(items["CHG-1"].change).toBe("modified");
    expect(items["FEAT-1"].change).toBe("unchanged");
    expect(diff(before, after).counts).toEqual({ added: 1, removed: 2, modified: 1, unchanged: 5 });
  });

  it("does not treat a renumbered/reordered list as a change when content and IDs match", () => {
    const after = validPackage();
    after.qaEvidence.reverse();
    expect(diff(validPackage(), after).counts.modified).toBe(0);
  });

  it("produces field-level differences for modified items", () => {
    const after = validPackage();
    after.changedBehaviour[0] = {
      ...after.changedBehaviour[0],
      description: "Idle sessions now expire after 15 minutes.",
      breaking: false,
      userGroups: ["Admins"],
    };
    after.qaEvidence[0].result = "partial";

    const items = byId(diff(validPackage(), after));
    expect(items["CHG-1"].fields).toEqual([
      { field: "description", label: "Description", before: "Idle sessions now expire after 30 minutes instead of 8 hours.", after: "Idle sessions now expire after 15 minutes." },
      { field: "userGroups", label: "User groups", before: "(none)", after: "Admins" },
      { field: "breaking", label: "Breaking change", before: "Yes", after: "No" },
    ]);
    expect(items["QA-1"].fields).toEqual([{ field: "result", label: "Result", before: "pass", after: "partial" }]);
  });

  it("reports QA coverage changes for change items, including unchanged ones", () => {
    const after = validPackage();
    after.qaEvidence.push({ id: "QA-4", title: "Extra export test", result: "fail", coversItemIds: ["FEAT-1"], notes: "" });
    const feat = byId(diff(validPackage(), after))["FEAT-1"];
    expect(feat.change).toBe("unchanged");
    expect(feat.qaCoverage).toEqual({ before: ["QA-1 (pass)"], after: ["QA-1 (pass)", "QA-4 (fail)"] });
    expect(byId(diff(validPackage(), after))["FIX-1"].qaCoverage).toBeUndefined();
  });

  it("flags covering QA evidence whose content changed", () => {
    const after = validPackage();
    after.qaEvidence[0].notes = "Re-run on rc2";
    expect(byId(diff(validPackage(), after))["FEAT-1"].qaCoverage).toEqual({
      before: ["QA-1 (pass)"],
      after: ["QA-1 (pass, evidence updated)"],
    });
  });
});

describe("diffVersions: package-level fields", () => {
  it("reports QA summary, user group and none-declared changes", () => {
    const before = validPackage();
    const after = validPackage();
    after.qaSummary = "Regression suite passed on build rc2.";
    after.affectedUserGroups = ["Billing admins", "Support agents"];
    after.migrationNotes = [];
    after.noneDeclared.migrationNotes = true;

    const d = diff(before, after);
    expect(d.scalars).toEqual([
      expect.objectContaining({ field: "qaSummary", before: before.qaSummary, after: "Regression suite passed on build rc2." }),
      expect.objectContaining({ field: "affectedUserGroups", added: ["Support agents"], removed: ["All signed-in users"] }),
      expect.objectContaining({ field: "noneDeclared.migrationNotes", before: "No", after: "Yes" }),
    ]);
    expect(d.changedSections.sort()).toEqual(["affectedUserGroups", "migrationNotes", "qaSummary"]);
  });
});
