// Item ID allocation. IDs are never reused within a release, even after an item
// is deleted, so a citation or diff keyed by ID always refers to the same item.

import {
  ITEM_ID_PREFIX,
  ITEM_SECTIONS,
  listItems,
  type ItemSection,
  type ReleasePackage,
} from "@/lib/schema/release-package";

/** Highest item number used so far, per section. */
export type ItemCounters = Record<ItemSection, number>;

export function emptyCounters(): ItemCounters {
  return Object.fromEntries(ITEM_SECTIONS.map((section) => [section, 0])) as ItemCounters;
}

function itemNumber(id: string): number {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/** Counters covering every ID used in any of the given packages. */
export function maxItemNumbers(packages: ReleasePackage[]): ItemCounters {
  const counters = emptyCounters();
  for (const pkg of packages) {
    for (const { section, item } of listItems(pkg)) {
      counters[section] = Math.max(counters[section], itemNumber(item.id));
    }
  }
  return counters;
}

export function nextItemId(section: ItemSection, counters: ItemCounters): { id: string; counters: ItemCounters } {
  const next = counters[section] + 1;
  return { id: `${ITEM_ID_PREFIX[section]}-${next}`, counters: { ...counters, [section]: next } };
}

/**
 * IDs that are new relative to `base` but were used by some earlier version.
 * Reusing one would make an unrelated item look like an edit of the deleted one.
 */
export function findReusedIds(candidate: ReleasePackage, base: ReleasePackage, history: ReleasePackage[]): string[] {
  const baseIds = new Set(listItems(base).map(({ item }) => item.id));
  const historicIds = new Set(history.flatMap((pkg) => listItems(pkg).map(({ item }) => item.id)));
  return listItems(candidate)
    .map(({ item }) => item.id)
    .filter((id) => !baseIds.has(id) && historicIds.has(id));
}
