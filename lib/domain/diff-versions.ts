// Version comparison. Items are matched by stable ID and classified with the
// item hashes stored on each immutable version; field-level differences are
// derived from the two package snapshots.

import { hashItem, type ItemHashes } from "@/lib/domain/hash";
import {
  listItems,
  type ItemSection,
  type ReleaseItem,
  type ReleasePackage,
} from "@/lib/schema/release-package";

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

export interface FieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface ItemDiff {
  id: string;
  section: ItemSection;
  change: ChangeType;
  /** Title (or text) from whichever side has the item; `to` wins when both do. */
  label: string;
  fields: FieldDiff[];
  /** For change items present in both versions: which QA evidence covers them, when that differs. */
  qaCoverage?: { before: string[]; after: string[] };
}

export interface ScalarDiff {
  field: "qaSummary" | "affectedUserGroups" | "noneDeclared.knownLimitations" | "noneDeclared.migrationNotes";
  label: string;
  before: string;
  after: string;
  added?: string[];
  removed?: string[];
}

export interface VersionDiff {
  items: ItemDiff[];
  scalars: ScalarDiff[];
  /** Sections whose content changed (any item added/removed/modified, or the scalar field changed). */
  changedSections: string[];
  counts: Record<ChangeType, number>;
}

const CHANGE_SECTIONS = new Set<ItemSection>(["features", "bugFixes", "changedBehaviour"]);

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  userGroups: "User groups",
  breaking: "Breaking change",
  result: "Result",
  coversItemIds: "Covers",
  notes: "Notes",
  text: "Text",
};

function labelOf(item: ReleaseItem): string {
  return "title" in item ? item.title : item.text;
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === undefined || value === null || value === "") return "(empty)";
  return String(value);
}

function fieldDiffs(before: ReleaseItem, after: ReleaseItem): FieldDiff[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => k !== "id"));
  const diffs: FieldDiff[] = [];
  for (const key of keys) {
    const a = (before as Record<string, unknown>)[key];
    const b = (after as Record<string, unknown>)[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ field: key, label: FIELD_LABELS[key] ?? key, before: display(a), after: display(b) });
    }
  }
  return diffs;
}

/** "QA-1 (pass)" entries for the QA evidence covering a change item; `updated` IDs are flagged. */
export function qaCoverageOf(pkg: ReleasePackage, itemId: string, updated: ReadonlySet<string> = new Set()): string[] {
  return pkg.qaEvidence
    .filter((qa) => qa.coversItemIds.includes(itemId))
    .map((qa) => `${qa.id} (${qa.result.replace("_", " ")}${updated.has(qa.id) ? ", evidence updated" : ""})`);
}

/** Coverage identity including each covering QA item's content hash, so edited evidence counts as a change. */
export function qaCoverageSignature(pkg: ReleasePackage, itemId: string): string {
  return pkg.qaEvidence
    .filter((qa) => qa.coversItemIds.includes(itemId))
    .map((qa) => `${qa.id}:${hashItem(qa)}`)
    .sort()
    .join("|");
}

export function diffVersions(
  from: { package: ReleasePackage; itemHashes: ItemHashes },
  to: { package: ReleasePackage; itemHashes: ItemHashes },
): VersionDiff {
  const fromItems = new Map(listItems(from.package).map((entry) => [entry.item.id, entry]));
  const toItems = new Map(listItems(to.package).map((entry) => [entry.item.id, entry]));
  const items: ItemDiff[] = [];
  const updatedQa = new Set(
    from.package.qaEvidence.filter((qa) => qa.id in to.itemHashes && from.itemHashes[qa.id] !== to.itemHashes[qa.id]).map((qa) => qa.id),
  );

  // `to` order first (so the result reads like the new version), then removed items.
  for (const [id, { section, item }] of toItems) {
    const previous = fromItems.get(id);
    if (!previous) {
      items.push({ id, section, change: "added", label: labelOf(item), fields: [] });
      continue;
    }
    const modified = from.itemHashes[id] !== to.itemHashes[id];
    const diff: ItemDiff = {
      id,
      section,
      change: modified ? "modified" : "unchanged",
      label: labelOf(item),
      fields: modified ? fieldDiffs(previous.item, item) : [],
    };
    if (CHANGE_SECTIONS.has(section) && qaCoverageSignature(from.package, id) !== qaCoverageSignature(to.package, id)) {
      diff.qaCoverage = { before: qaCoverageOf(from.package, id), after: qaCoverageOf(to.package, id, updatedQa) };
    }
    items.push(diff);
  }
  for (const [id, { section, item }] of fromItems) {
    if (!toItems.has(id)) items.push({ id, section, change: "removed", label: labelOf(item), fields: [] });
  }

  const scalars: ScalarDiff[] = [];
  if (from.package.qaSummary !== to.package.qaSummary) {
    scalars.push({ field: "qaSummary", label: "QA summary", before: display(from.package.qaSummary), after: display(to.package.qaSummary) });
  }
  const groupsBefore = from.package.affectedUserGroups;
  const groupsAfter = to.package.affectedUserGroups;
  if (JSON.stringify(groupsBefore) !== JSON.stringify(groupsAfter)) {
    scalars.push({
      field: "affectedUserGroups",
      label: "Affected user groups",
      before: display(groupsBefore),
      after: display(groupsAfter),
      added: groupsAfter.filter((g) => !groupsBefore.includes(g)),
      removed: groupsBefore.filter((g) => !groupsAfter.includes(g)),
    });
  }
  for (const key of ["knownLimitations", "migrationNotes"] as const) {
    if (from.package.noneDeclared[key] !== to.package.noneDeclared[key]) {
      scalars.push({
        field: `noneDeclared.${key}`,
        label: key === "knownLimitations" ? "“No known limitations” declared" : "“No migration steps” declared",
        before: display(from.package.noneDeclared[key]),
        after: display(to.package.noneDeclared[key]),
      });
    }
  }

  const changedSections = new Set<string>();
  for (const item of items) if (item.change !== "unchanged") changedSections.add(item.section);
  for (const scalar of scalars) changedSections.add(scalar.field.startsWith("noneDeclared.") ? scalar.field.split(".")[1] : scalar.field);

  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const item of items) counts[item.change]++;

  return { items, scalars, changedSections: [...changedSections], counts };
}
