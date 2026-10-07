import { describe, expect, it } from "vitest";
import { validatePackage, type ValidationResult } from "@/lib/domain/validate-package";
import { ReleasePackageSchema } from "@/lib/schema/release-package";
import { validPackage } from "../fixtures/release-package";

const codes = (issues: ValidationResult["errors"]) => issues.map((issue) => issue.code);

describe("validatePackage", () => {
  it("accepts a complete package with no errors or warnings", () => {
    const result = validatePackage(validPackage());
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  describe("required sections", () => {
    it("requires at least one change item", () => {
      const pkg = { ...validPackage(), features: [], bugFixes: [], changedBehaviour: [], qaEvidence: [] };
      const result = validatePackage(pkg);
      expect(result.valid).toBe(false);
      expect(codes(result.errors)).toContain("NO_CHANGE_ITEMS");
    });

    it("accepts a package with only bug fixes", () => {
      const pkg = validPackage();
      pkg.features = [];
      pkg.changedBehaviour = [];
      pkg.qaEvidence = pkg.qaEvidence.filter((qa) => qa.id === "QA-2");
      expect(validatePackage(pkg).valid).toBe(true);
    });

    it("requires a QA summary (whitespace-only counts as missing)", () => {
      const pkg = ReleasePackageSchema.parse({ ...validPackage(), qaSummary: "   \n " });
      const result = validatePackage(pkg);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "QA_SUMMARY_MISSING", path: "qaSummary" }),
      );
    });

    it("requires at least one non-empty affected user group", () => {
      expect(codes(validatePackage({ ...validPackage(), affectedUserGroups: [] }).errors)).toContain(
        "USER_GROUPS_MISSING",
      );
      expect(codes(validatePackage({ ...validPackage(), affectedUserGroups: [""] }).errors)).toEqual([
        "USER_GROUPS_MISSING",
      ]);
    });

    it("flags a blank user group alongside valid ones", () => {
      const result = validatePackage({ ...validPackage(), affectedUserGroups: ["Admins", ""] });
      expect(result.errors).toEqual([expect.objectContaining({ code: "EMPTY_ENTRY", path: "affectedUserGroups[1]" })]);
    });

    it.each([
      ["knownLimitations", "LIMITATIONS_MISSING"],
      ["migrationNotes", "MIGRATION_NOTES_MISSING"],
    ] as const)("requires %s unless explicitly declared none", (section, code) => {
      const missing = validatePackage({ ...validPackage(), [section]: [] });
      expect(codes(missing.errors)).toContain(code);

      const pkg = validPackage();
      const declaredNone = validatePackage({
        ...pkg,
        [section]: [],
        noneDeclared: { ...pkg.noneDeclared, [section]: true },
      });
      expect(codes(declaredNone.errors)).not.toContain(code);
    });

    it("rejects declaring none while also providing entries", () => {
      const pkg = validPackage();
      pkg.noneDeclared.knownLimitations = true;
      const result = validatePackage(pkg);
      expect(result.errors).toEqual([
        expect.objectContaining({ code: "NONE_DECLARED_CONFLICT", path: "knownLimitations" }),
      ]);
    });
  });

  describe("item integrity", () => {
    it("rejects duplicate item IDs and points at the duplicate", () => {
      const pkg = validPackage();
      pkg.features.push({ ...pkg.features[0], title: "Another feature" });
      const result = validatePackage(pkg);
      expect(result.errors).toEqual([
        expect.objectContaining({ code: "DUPLICATE_ITEM_ID", path: "features[1].id", itemId: "FEAT-1" }),
      ]);
    });

    it("requires item titles and non-empty limitation/migration text", () => {
      const pkg = validPackage();
      pkg.bugFixes[0].title = "";
      pkg.qaEvidence[0].title = "";
      pkg.migrationNotes[0].text = "";
      const result = validatePackage(pkg);
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["EMPTY_ENTRY", "migrationNotes[0].text"],
        ["ITEM_TITLE_MISSING", "bugFixes[0].title"],
        ["ITEM_TITLE_MISSING", "qaEvidence[0].title"],
      ]);
    });

    it("rejects QA evidence that references unknown or non-change items", () => {
      const pkg = validPackage();
      pkg.qaEvidence[0].coversItemIds = ["FEAT-1", "FEAT-99", "LIM-1"];
      const result = validatePackage(pkg);
      expect(result.errors.map((e) => e.path)).toEqual([
        "qaEvidence[0].coversItemIds[1]",
        "qaEvidence[0].coversItemIds[2]",
      ]);
      expect(codes(result.errors)).toEqual(["QA_UNKNOWN_COVERED_ITEM", "QA_UNKNOWN_COVERED_ITEM"]);
    });
  });

  describe("warnings (non-blocking)", () => {
    it("warns about change items without QA coverage", () => {
      const pkg = validPackage();
      pkg.qaEvidence = pkg.qaEvidence.filter((qa) => qa.id !== "QA-3");
      const result = validatePackage(pkg);
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([
        expect.objectContaining({ code: "ITEM_NO_QA_COVERAGE", itemId: "CHG-1", path: "changedBehaviour[0]" }),
      ]);
    });

    it("emits a single warning instead of per-item warnings when there is no QA evidence at all", () => {
      const result = validatePackage({ ...validPackage(), qaEvidence: [] });
      expect(result.valid).toBe(true);
      expect(codes(result.warnings)).toEqual(["QA_EVIDENCE_EMPTY"]);
    });

    it("warns about QA evidence that did not pass, or that covers nothing", () => {
      const pkg = validPackage();
      pkg.qaEvidence[0].result = "fail";
      pkg.qaEvidence.push({ id: "QA-4", title: "Exploratory", result: "not_run", coversItemIds: [], notes: "" });
      const result = validatePackage(pkg);
      expect(result.valid).toBe(true);
      expect(result.warnings.map((w) => [w.code, w.itemId])).toEqual([
        ["QA_NOT_PASSED", "QA-1"],
        ["QA_NOT_PASSED", "QA-4"],
        ["QA_COVERS_NOTHING", "QA-4"],
      ]);
    });

    it("warns when a breaking change has no migration notes", () => {
      const pkg = validPackage();
      pkg.migrationNotes = [];
      pkg.noneDeclared.migrationNotes = true;
      const result = validatePackage(pkg);
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([
        expect.objectContaining({ code: "BREAKING_CHANGE_NO_MIGRATION", itemId: "CHG-1" }),
      ]);
    });

    it("warns about missing or very short descriptions", () => {
      const pkg = validPackage();
      pkg.features[0].description = "CSV export";
      expect(validatePackage(pkg).warnings).toEqual([
        expect.objectContaining({ code: "DESCRIPTION_TOO_SHORT", path: "features[0].description" }),
      ]);
    });
  });

  it("is deterministic", () => {
    const pkg = { ...validPackage(), qaSummary: "", qaEvidence: [] };
    expect(validatePackage(pkg)).toEqual(validatePackage(structuredClone(pkg)));
  });
});

describe("ReleasePackageSchema", () => {
  it("applies defaults so a sparse draft can still be parsed", () => {
    const pkg = ReleasePackageSchema.parse({ features: [{ id: "FEAT-1", title: "X" }] });
    expect(pkg.features[0]).toEqual({ id: "FEAT-1", title: "X", description: "", userGroups: [] });
    expect(pkg.noneDeclared).toEqual({ knownLimitations: false, migrationNotes: false });
    expect(pkg.qaEvidence).toEqual([]);
  });

  it("rejects IDs with the wrong section prefix", () => {
    const result = ReleasePackageSchema.safeParse({ bugFixes: [{ id: "FEAT-1", title: "X" }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["bugFixes", 0, "id"]);
  });

  it("rejects unknown QA results", () => {
    const result = ReleasePackageSchema.safeParse({ qaEvidence: [{ id: "QA-1", title: "X", result: "ok" }] });
    expect(result.success).toBe(false);
  });

  it("trims text fields", () => {
    const pkg = ReleasePackageSchema.parse({ qaSummary: "  passed  ", affectedUserGroups: [" Admins "] });
    expect(pkg.qaSummary).toBe("passed");
    expect(pkg.affectedUserGroups).toEqual(["Admins"]);
  });
});
