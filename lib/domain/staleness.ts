// Staleness of a generated statement relative to another (normally the current)
// version. Purely hash-based for citations; section-based, conservative rules for
// conclusions that depend on QA evidence or on whole sections. Citations are
// never rewritten: the hash stored at generation time is what gets compared.

import { qaCoverageSignature, type VersionDiff } from "@/lib/domain/diff-versions";
import type { ItemHashes } from "@/lib/domain/hash";
import type { StatementKind } from "@/lib/generated/prisma/enums";
import type { ReleasePackage } from "@/lib/schema/release-package";

export interface StaleCitation {
  itemId: string;
  itemHash: string;
}

export interface StatementForStaleness {
  kind: StatementKind;
  content: string;
  citations: StaleCitation[];
  metadata?: Record<string, unknown> | null;
}

export interface StaleResult {
  stale: boolean;
  reasons: string[];
}

export interface StalenessContext {
  /** Package the statement was generated from. */
  from: ReleasePackage;
  /** Version the statement is evaluated against. */
  to: { package: ReleasePackage; itemHashes: ItemHashes };
  diff: VersionDiff;
}

/** Kinds whose conclusions depend on QA evidence (coverage, verification status, unsupported claims). */
const QA_DEPENDENT: ReadonlySet<StatementKind> = new Set([
  "MISSING_INFO",
  "UNSUPPORTED_CLAIM",
  "RISK",
  "TECH_SUMMARY",
  "NONTECH_SUMMARY",
]);

const CHANGE_PREFIX = /^(FEAT|FIX|CHG)-\d+$/;

/** QA-dependent by kind, or because the text itself reasons about testing/verification (e.g. an impact rationale). */
function dependsOnQa(statement: StatementForStaleness): boolean {
  return QA_DEPENDENT.has(statement.kind) || /\b(QA|tested|testing|verif\w*)\b/i.test(statement.content);
}

const SECTION_LABEL: Record<string, string> = {
  features: "Features",
  bugFixes: "Bug fixes",
  changedBehaviour: "Changed behaviour",
  qaEvidence: "QA evidence",
  qaSummary: "QA summary",
  knownLimitations: "Known limitations",
  migrationNotes: "Migration notes",
  affectedUserGroups: "Affected user groups",
};

const ALL_CONTENT_SECTIONS = Object.keys(SECTION_LABEL);

/** Sections that can fill a reported gap without touching the cited item itself. */
const GAP_FILLING_SECTIONS = new Set(["migrationNotes", "knownLimitations", "affectedUserGroups"]);

/** Sections a statement's text is about, from keywords (may be empty). */
export function keywordSections(statement: StatementForStaleness): string[] {
  const text = statement.content;
  const sections = new Set<string>();
  if (/\b(migrat\w*|config\w*|backfill|rollback|roll-?out|operator|environment variable)\b/i.test(text)) {
    sections.add("migrationNotes").add("changedBehaviour");
  }
  if (/\b(QA|test\w*|verif\w*|evidence|coverage)\b/i.test(text)) sections.add("qaEvidence").add("qaSummary");
  if (/\blimitation\w*\b/i.test(text)) sections.add("knownLimitations");
  if (/\b(user groups?|audience|customers?|admins?|users)\b/i.test(text)) sections.add("affectedUserGroups");
  if (/\bfeatures?\b/i.test(text)) sections.add("features");
  if (/\b(bug|fix(es|ed)?)\b/i.test(text)) sections.add("bugFixes");
  if (/\b(breaking|behaviou?r)\b/i.test(text)) sections.add("changedBehaviour");
  if (statement.metadata?.rule === "BREAKING_NO_MIGRATION") sections.add("migrationNotes");
  return [...sections];
}

/**
 * Sections whose change makes a statement stale beyond its citations:
 * - uncited statements: the sections their text is about, or every content section
 *   when the text names none (conservative: nothing anchors them);
 * - cited MISSING_INFO: only sections that could fill the gap (e.g. migration notes
 *   for "no rollback plan"); QA gaps are handled precisely by the QA-dependency rule.
 * - other cited statements: none (citations and QA dependency are precise).
 */
export function relevantSections(statement: StatementForStaleness): string[] {
  const matched = keywordSections(statement);
  if (statement.citations.length === 0) return matched.length > 0 ? matched : ALL_CONTENT_SECTIONS;
  if (statement.kind === "MISSING_INFO") return matched.filter((s) => GAP_FILLING_SECTIONS.has(s));
  return [];
}

function describeSectionChange(section: string, diff: VersionDiff): string {
  const items = diff.items.filter((i) => i.section === section && i.change !== "unchanged");
  const detail = items.map((i) => `${i.id} ${i.change}`).join(", ");
  return `${SECTION_LABEL[section] ?? section} changed${detail ? ` (${detail})` : ""}`;
}

export function computeStaleness(statement: StatementForStaleness, ctx: StalenessContext): StaleResult {
  const reasons: string[] = [];

  // 1. Citations: the stored hash must still match the item in the target version.
  for (const citation of statement.citations) {
    const current = ctx.to.itemHashes[citation.itemId];
    if (current === undefined) reasons.push(`${citation.itemId} was removed`);
    else if (current !== citation.itemHash) reasons.push(`${citation.itemId} was modified`);
  }

  // 2. QA dependency: conclusions about a change item depend on the QA evidence covering it,
  //    even when the change item itself is unchanged (e.g. new evidence was added).
  if (dependsOnQa(statement)) {
    for (const { itemId } of statement.citations) {
      if (!CHANGE_PREFIX.test(itemId) || !(itemId in ctx.to.itemHashes)) continue;
      if (qaCoverageSignature(ctx.from, itemId) !== qaCoverageSignature(ctx.to.package, itemId)) {
        reasons.push(`QA evidence for ${itemId} changed`);
      }
    }
  }

  // 3. Section rules for uncited statements and missing-information gaps (see relevantSections).
  for (const section of relevantSections(statement)) {
    if (ctx.diff.changedSections.includes(section)) reasons.push(describeSectionChange(section, ctx.diff));
  }

  const unique = [...new Set(reasons)];
  return { stale: unique.length > 0, reasons: unique };
}
