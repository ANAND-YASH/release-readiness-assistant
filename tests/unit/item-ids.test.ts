import { describe, expect, it } from "vitest";
import { emptyCounters, findReusedIds, maxItemNumbers, nextItemId } from "@/lib/domain/item-ids";
import { validPackage } from "../fixtures/release-package";

describe("item ID allocation", () => {
  it("allocates sequential IDs per section with the right prefix", () => {
    let counters = emptyCounters();
    const ids: string[] = [];
    for (const section of ["features", "features", "qaEvidence"] as const) {
      const next = nextItemId(section, counters);
      ids.push(next.id);
      counters = next.counters;
    }
    expect(ids).toEqual(["FEAT-1", "FEAT-2", "QA-1"]);
  });

  it("continues after the highest number used in any version, so deleted IDs are not reused", () => {
    const v1 = validPackage();
    v1.features.push({ ...v1.features[0], id: "FEAT-7" });
    const v2 = validPackage(); // FEAT-7 deleted
    const counters = maxItemNumbers([v1, v2]);
    expect(nextItemId("features", counters).id).toBe("FEAT-8");
    expect(nextItemId("qaEvidence", counters).id).toBe("QA-4");
  });
});

describe("findReusedIds", () => {
  it("flags new IDs that belonged to an item deleted in an earlier version", () => {
    const v1 = validPackage();
    v1.features.push({ ...v1.features[0], id: "FEAT-2", title: "Old feature" });
    const v2 = validPackage(); // FEAT-2 deleted
    const candidate = validPackage();
    candidate.features.push({ ...candidate.features[0], id: "FEAT-2", title: "Unrelated new feature" });

    expect(findReusedIds(candidate, v2, [v1])).toEqual(["FEAT-2"]);
  });

  it("allows IDs carried over from the base version and brand-new IDs", () => {
    const base = validPackage();
    const candidate = validPackage();
    candidate.features.push({ ...candidate.features[0], id: "FEAT-9" });
    expect(findReusedIds(candidate, base, [base])).toEqual([]);
  });
});
