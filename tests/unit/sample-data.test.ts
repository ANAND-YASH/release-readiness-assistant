import { describe, expect, it } from "vitest";
import { computeItemHashes } from "@/lib/domain/hash";
import { findReusedIds } from "@/lib/domain/item-ids";
import { validatePackage } from "@/lib/domain/validate-package";
import { SAMPLE_V1, SAMPLE_V2 } from "@/lib/sample-data";
import { ReleasePackageSchema } from "@/lib/schema/release-package";

const v1 = ReleasePackageSchema.parse(SAMPLE_V1);
const v2 = ReleasePackageSchema.parse(SAMPLE_V2);

describe("sample release data", () => {
  it("both versions pass validation, so the seed can never fail", () => {
    expect(validatePackage(v1).errors).toEqual([]);
    expect(validatePackage(v2).errors).toEqual([]);
  });

  it("has added, removed, modified and unchanged items between versions", () => {
    const before = computeItemHashes(v1);
    const after = computeItemHashes(v2);
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    const groups = { added: [] as string[], removed: [] as string[], modified: [] as string[], unchanged: [] as string[] };
    for (const id of ids) {
      if (!before[id]) groups.added.push(id);
      else if (!after[id]) groups.removed.push(id);
      else if (before[id] !== after[id]) groups.modified.push(id);
      else groups.unchanged.push(id);
    }
    expect(groups.added.sort()).toEqual(["FIX-3", "MIG-3", "QA-7"]);
    expect(groups.removed.sort()).toEqual(["FEAT-3", "LIM-2", "QA-6"]);
    expect(groups.modified.sort()).toEqual(["CHG-1", "FEAT-1", "LIM-1", "QA-1", "QA-2"]);
    expect(groups.unchanged.length).toBeGreaterThan(5);
  });

  it("does not reuse any deleted ID", () => {
    expect(findReusedIds(v2, v1, [])).toEqual([]);
  });
});
