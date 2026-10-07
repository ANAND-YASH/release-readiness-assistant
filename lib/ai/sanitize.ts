// Citation safety: converts schema-valid model output into DraftStatements that
// only reference items that exist in the analysed version. Anything that cannot
// be grounded is dropped and reported, never persisted.

import { containsUnhedgedClaim } from "@/lib/domain/claims";
import { listItems, type ItemSection, type ReleasePackage } from "@/lib/schema/release-package";
import type { AnalysisOutput, SummariesOutput } from "./output-schema";
import type { DraftStatement, DroppedOutput } from "./types";

export interface ItemIndex {
  sections: Map<string, ItemSection>;
  titles: Map<string, string>;
}

export function indexItems(pkg: ReleasePackage): ItemIndex {
  const sections = new Map<string, ItemSection>();
  const titles = new Map<string, string>();
  for (const { section, item } of listItems(pkg)) {
    sections.set(item.id, section);
    titles.set(item.id, "title" in item ? item.title : item.text);
  }
  return { sections, titles };
}

const CHANGE_SECTIONS = new Set<ItemSection>(["features", "bugFixes", "changedBehaviour"]);

interface Sanitized {
  statements: DraftStatement[];
  dropped: DroppedOutput[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split IDs into those that exist (optionally restricted to a predicate) and those that don't; dedupes. */
function partitionIds(ids: string[], index: ItemIndex, accept: (section: ItemSection) => boolean = () => true) {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    const section = index.sections.get(id);
    if (section && accept(section)) {
      if (!valid.includes(id)) valid.push(id);
    } else if (!invalid.includes(id)) {
      invalid.push(id);
    }
  }
  return { valid, invalid };
}

export function sanitizeAnalysis(
  output: AnalysisOutput,
  index: ItemIndex,
  existing: DraftStatement[] = [],
): Sanitized {
  const statements: DraftStatement[] = [];
  const dropped: DroppedOutput[] = [];
  const seen = new Set(existing.map((s) => `${s.kind}:${normalize(s.content)}`));
  const seenClaims = new Set(
    existing.filter((s) => s.kind === "UNSUPPORTED_CLAIM").map((s) => normalize(String(s.metadata?.claimText ?? ""))),
  );
  const push = (statement: DraftStatement) => {
    const key = `${statement.kind}:${normalize(statement.content)}`;
    if (seen.has(key)) {
      dropped.push({ kind: statement.kind, reason: "duplicate", detail: statement.content.slice(0, 120) });
      return;
    }
    seen.add(key);
    statements.push(statement);
  };
  const noteInvalid = (kind: DraftStatement["kind"], invalid: string[]) => {
    if (invalid.length > 0) {
      dropped.push({ kind, reason: "invalid_citation", detail: "Removed citations to unknown items", ids: invalid });
    }
  };

  // IMPACT: exactly one per change item; itemId must be a FEAT/FIX/CHG of this version.
  const classified = new Set<string>();
  for (const entry of output.impactClassifications) {
    const id = entry.itemId.trim();
    const section = index.sections.get(id);
    if (!section || !CHANGE_SECTIONS.has(section)) {
      dropped.push({ kind: "IMPACT", reason: "unknown_item", detail: "Classification for an unknown change item", ids: [id] });
      continue;
    }
    if (classified.has(id)) {
      dropped.push({ kind: "IMPACT", reason: "duplicate", detail: `Second classification for ${id}`, ids: [id] });
      continue;
    }
    classified.add(id);
    const groups = entry.userGroups.map((g) => g.trim()).filter(Boolean);
    push({
      kind: "IMPACT",
      source: "AI",
      level: entry.impact,
      content: `${id} ${index.titles.get(id)}: ${entry.impact} impact${groups.length ? ` for ${groups.join(", ")}` : ""}. ${entry.rationale.trim()}`,
      citations: [id],
      metadata: { itemId: id, userGroups: groups, rationale: entry.rationale.trim() },
    });
  }

  // MISSING_INFO: citations optional (package-level gaps), but never to unknown items.
  for (const entry of output.missingInformation) {
    const description = entry.description.trim();
    if (!description) {
      dropped.push({ kind: "MISSING_INFO", reason: "empty", detail: "Empty description" });
      continue;
    }
    const { valid, invalid } = partitionIds(entry.relatedItemIds, index);
    noteInvalid("MISSING_INFO", invalid);
    push({ kind: "MISSING_INFO", source: "AI", level: null, content: description, citations: valid });
  }

  // UNSUPPORTED_CLAIM: claiming item must exist; QA citations must be QA items; at least one citation.
  for (const entry of output.unsupportedClaims) {
    const claimText = entry.claimText.trim();
    if (seenClaims.has(normalize(claimText))) {
      dropped.push({ kind: "UNSUPPORTED_CLAIM", reason: "duplicate", detail: claimText.slice(0, 120) });
      continue;
    }
    const itemId = entry.itemId?.trim() || null;
    const itemValid = itemId === null || index.sections.has(itemId);
    const qa = partitionIds(entry.qaItemIds, index, (section) => section === "qaEvidence");
    const invalid = [...(itemValid ? [] : [itemId!]), ...qa.invalid];
    noteInvalid("UNSUPPORTED_CLAIM", invalid);
    const citations = [...(itemValid && itemId ? [itemId] : []), ...qa.valid.filter((id) => id !== itemId)];
    if (!claimText || citations.length === 0) {
      dropped.push({
        kind: "UNSUPPORTED_CLAIM",
        reason: "missing_citation",
        detail: `Claim without a valid citation: ${claimText.slice(0, 120)}`,
      });
      continue;
    }
    seenClaims.add(normalize(claimText));
    const where = itemValid && itemId ? itemId : "the QA summary";
    push({
      kind: "UNSUPPORTED_CLAIM",
      source: "AI",
      level: null,
      content: `Unsupported claim in ${where}: "${claimText}" ${entry.reason.trim()}`,
      citations,
      metadata: { claimText, reason: entry.reason.trim(), itemId: itemValid ? itemId : null, qaItemIds: qa.valid },
    });
  }

  // RISK: at least one valid citation.
  for (const entry of output.risks) {
    const { valid, invalid } = partitionIds(entry.citations, index);
    noteInvalid("RISK", invalid);
    if (valid.length === 0 || !entry.description.trim()) {
      dropped.push({
        kind: "RISK",
        reason: "missing_citation",
        detail: `Risk without a valid citation: ${entry.description.slice(0, 120)}`,
      });
      continue;
    }
    push({ kind: "RISK", source: "AI", level: entry.severity, content: entry.description.trim(), citations: valid });
  }

  return { statements, dropped };
}

export function sanitizeSummaries(output: SummariesOutput, index: ItemIndex): Sanitized {
  const statements: DraftStatement[] = [];
  const dropped: DroppedOutput[] = [];
  const groups = [
    ["TECH_SUMMARY", output.technicalSummary],
    ["NONTECH_SUMMARY", output.nonTechnicalSummary],
  ] as const;

  for (const [kind, entries] of groups) {
    for (const entry of entries) {
      const content = entry.content.trim();
      const { valid, invalid } = partitionIds(entry.citations, index);
      if (invalid.length > 0) {
        dropped.push({ kind, reason: "invalid_citation", detail: "Removed citations to unknown items", ids: invalid });
      }
      if (!content) {
        dropped.push({ kind, reason: "empty", detail: "Empty statement" });
      } else if (valid.length === 0) {
        dropped.push({ kind, reason: "missing_citation", detail: `Summary statement without a valid citation: ${content.slice(0, 120)}` });
      } else if (containsUnhedgedClaim(content)) {
        // Safety net: summaries must not assert absolute claims as fact.
        dropped.push({ kind, reason: "unhedged_claim", detail: content.slice(0, 160), ids: valid });
      } else {
        statements.push({ kind, source: "AI", level: null, content, citations: valid });
      }
    }
  }
  return { statements, dropped };
}
