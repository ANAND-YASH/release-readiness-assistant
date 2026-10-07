import { describe, expect, it } from "vitest";
import { checkPackage, formatPath, issuesUnder } from "@/components/package-editor/form-issues";
import { readinessChecklist } from "@/lib/domain/readiness";
import { validatePackage } from "@/lib/domain/validate-package";
import { validPackage } from "../fixtures/release-package";

describe("editor form issues", () => {
  it("formats Zod paths like validatePackage paths", () => {
    expect(formatPath(["features", 0, "title"])).toBe("features[0].title");
    expect(formatPath(["qaEvidence", 1, "coversItemIds", 2])).toBe("qaEvidence[1].coversItemIds[2]");
  });

  it("reports schema errors (e.g. over-long title) at the field path", () => {
    const pkg = validPackage();
    pkg.features[0].title = "x".repeat(201);
    expect(checkPackage(pkg)).toEqual([
      expect.objectContaining({ severity: "error", path: "features[0].title", code: "SCHEMA" }),
    ]);
  });

  it("returns the same business-rule issues as the server", () => {
    const pkg = { ...validPackage(), qaSummary: "" };
    const server = validatePackage(pkg);
    expect(checkPackage(pkg)).toEqual([...server.errors, ...server.warnings]);
  });

  it("selects issues nested under an item path without matching sibling indices", () => {
    const issues = [
      { severity: "error" as const, path: "features[1].title", message: "a" },
      { severity: "error" as const, path: "features[10].title", message: "b" },
      { severity: "warning" as const, path: "features[1]", message: "c" },
    ];
    expect(issuesUnder(issues, "features[1]").map((i) => i.message)).toEqual(["a", "c"]);
  });
});

describe("readinessChecklist", () => {
  it("marks validation items done and AI/approval items pending for a clean package", () => {
    const items = readinessChecklist(validatePackage(validPackage()));
    expect(items.filter((i) => i.state === "done").map((i) => i.key)).toEqual([
      "validation",
      "qa-coverage",
      "qa-results",
      "other-warnings",
    ]);
    expect(items.find((i) => i.key === "decision")?.state).toBe("pending");
  });

  it("flags QA coverage gaps and failed QA as needing attention", () => {
    const pkg = validPackage();
    pkg.qaEvidence[0].result = "fail";
    pkg.qaEvidence.pop();
    const states = Object.fromEntries(readinessChecklist(validatePackage(pkg)).map((i) => [i.key, i.state]));
    expect(states["qa-coverage"]).toBe("attention");
    expect(states["qa-results"]).toBe("attention");
    expect(states["other-warnings"]).toBe("done");
  });
});
