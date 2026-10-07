// Deterministic QA coverage: how well each change item is backed by QA evidence.

import { listChangeItems, type ChangeSection, type QaResult, type ReleasePackage } from "@/lib/schema/release-package";

/**
 * verified    at least one covering QA item passed
 * partial     no pass, but at least one partial result
 * not_passed  covered only by failed or not-run QA
 * uncovered   no QA evidence references the item
 */
export type CoverageStatus = "verified" | "partial" | "not_passed" | "uncovered";

export interface CoverageEntry {
  itemId: string;
  section: ChangeSection;
  title: string;
  status: CoverageStatus;
  qa: { id: string; result: QaResult }[];
}

export function qaCoverage(pkg: ReleasePackage): CoverageEntry[] {
  return listChangeItems(pkg).map(({ section, item }) => {
    const qa = pkg.qaEvidence
      .filter((evidence) => evidence.coversItemIds.includes(item.id))
      .map((evidence) => ({ id: evidence.id, result: evidence.result }));
    const results = new Set(qa.map((q) => q.result));
    const status: CoverageStatus =
      qa.length === 0 ? "uncovered" : results.has("pass") ? "verified" : results.has("partial") ? "partial" : "not_passed";
    return { itemId: item.id, section, title: item.title, status, qa };
  });
}
