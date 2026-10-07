// Final release brief: blocking conditions, statement selection and deterministic
// Markdown assembly. No model is involved: the brief is exactly the human-reviewed
// statements, grouped into sections, with their citations.

import type { ReviewStatus, StatementKind } from "@/lib/generated/prisma/enums";

export type BlockerCode =
  | "VALIDATION_ERRORS"
  | "NO_ANALYSIS"
  | "UNANALYSED_ITEMS"
  | "PENDING_STATEMENTS"
  | "STALE_STATEMENTS"
  | "NO_USABLE_STATEMENTS"
  | "BRIEF_MISSING"
  | "BRIEF_OUTDATED";

export interface Blocker {
  code: BlockerCode;
  message: string;
}

export interface BriefStatement {
  id: string;
  kind: StatementKind;
  reviewStatus: ReviewStatus;
  /** Effective content: editedContent when edited, otherwise the generated text. */
  content: string;
  citations: { itemId: string; itemHash: string }[];
  stale: boolean;
  order: number;
}

export interface BriefInputs {
  versionNumber: number;
  validationErrorCount: number;
  hasAnalysis: boolean;
  /** Change items added since the analysed version (carried-over analysis only). */
  unanalysedItemIds: string[];
  statements: BriefStatement[];
}

/** Statements that may appear in the brief: human-approved or human-edited, and not stale. */
export function selectBriefStatements(statements: BriefStatement[]): BriefStatement[] {
  return statements
    .filter((s) => (s.reviewStatus === "APPROVED" || s.reviewStatus === "EDITED") && !s.stale)
    .sort((a, b) => a.order - b.order);
}

export function briefBlockers(input: BriefInputs): Blocker[] {
  const blockers: Blocker[] = [];
  const v = `v${input.versionNumber}`;
  if (input.validationErrorCount > 0) {
    blockers.push({
      code: "VALIDATION_ERRORS",
      message: `${v} has ${input.validationErrorCount} blocking validation error(s). Fix the package first.`,
    });
  }
  if (!input.hasAnalysis) {
    blockers.push({ code: "NO_ANALYSIS", message: `No successful AI analysis exists for ${v}. Run analysis on the Review page.` });
    return blockers;
  }
  if (input.unanalysedItemIds.length > 0) {
    blockers.push({
      code: "UNANALYSED_ITEMS",
      message: `${input.unanalysedItemIds.join(", ")} ${input.unanalysedItemIds.length === 1 ? "was" : "were"} added after the analysis was run. Re-run analysis for ${v}.`,
    });
  }
  const pending = input.statements.filter((s) => s.reviewStatus === "PENDING").length;
  if (pending > 0) {
    blockers.push({ code: "PENDING_STATEMENTS", message: `${pending} statement(s) are still pending review.` });
  }
  // A rejected stale statement is resolved (it is excluded anyway).
  const stale = input.statements.filter((s) => s.stale && s.reviewStatus !== "REJECTED").length;
  if (stale > 0) {
    blockers.push({
      code: "STALE_STATEMENTS",
      message: `${stale} statement(s) are stale for ${v}. Reject them or re-run analysis to regenerate them.`,
    });
  }
  // Only meaningful once nothing is pending (otherwise it's just a consequence of pending reviews).
  if (pending === 0 && selectBriefStatements(input.statements).length === 0) {
    blockers.push({ code: "NO_USABLE_STATEMENTS", message: "No approved or edited statements to include in the brief." });
  }
  return blockers;
}

export interface BriefRelease {
  name: string;
  product: string;
  /** YYYY-MM-DD */
  targetDate: string | null;
}

export interface CitableItem {
  section: string;
  label: string;
}

const CHANGE_ID = /^(FEAT|FIX|CHG)-\d+$/;

interface SectionDef {
  title: string;
  select: (s: BriefStatement) => boolean;
}

/** Each statement lands in exactly one section, in this order. */
const SECTIONS: SectionDef[] = [
  {
    title: "What's Changed",
    select: (s) => s.kind === "TECH_SUMMARY" && s.citations.some((c) => CHANGE_ID.test(c.itemId)),
  },
  { title: "User Impact", select: (s) => s.kind === "IMPACT" },
  { title: "Risks & Limitations", select: (s) => s.kind === "RISK" },
  { title: "Technical Summary", select: (s) => s.kind === "TECH_SUMMARY" },
  { title: "For Users / Clients", select: (s) => s.kind === "NONTECH_SUMMARY" },
  { title: "QA / Validation", select: (s) => s.kind === "UNSUPPORTED_CLAIM" || s.kind === "MISSING_INFO" },
];

export interface AssembledBrief {
  markdown: string;
  statementIds: string[];
  sections: { title: string; statementIds: string[] }[];
}

function formatDate(date: string | null): string {
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** Escape characters that would change Markdown structure inside a list item. */
function inline(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").replace(/([\\`*_[\]])/g, "\\$1").trim();
}

/**
 * Deterministic: the same release, version, statements and items always produce
 * byte-identical Markdown (no timestamps; the generation time is stored on the record).
 */
export function assembleBrief(
  release: BriefRelease,
  versionNumber: number,
  statements: BriefStatement[],
  items: Record<string, CitableItem>,
): AssembledBrief {
  const included = selectBriefStatements(statements);
  const remaining = new Set(included.map((s) => s.id));
  const lines: string[] = [
    `# Release Brief: ${inline(release.name)}`,
    "",
    `- **Product:** ${inline(release.product)}`,
    `- **Version:** v${versionNumber}`,
    `- **Target date:** ${formatDate(release.targetDate)}`,
    `- **Statements included:** ${included.length} (human-approved or edited)`,
    "",
    "_Assembled from human-reviewed statements only. Bracketed IDs cite release items and QA evidence listed under Sources. Approving the release is a separate human decision._",
  ];

  const sections: AssembledBrief["sections"] = [];
  for (const section of SECTIONS) {
    const chosen = included.filter((s) => remaining.has(s.id) && section.select(s));
    if (chosen.length === 0) continue;
    chosen.forEach((s) => remaining.delete(s.id));
    sections.push({ title: section.title, statementIds: chosen.map((s) => s.id) });
    lines.push("", `## ${section.title}`, "");
    for (const statement of chosen) {
      const cites = statement.citations.map((c) => c.itemId);
      lines.push(`- ${inline(statement.content)}${cites.length ? ` [${cites.join(", ")}]` : ""}`);
    }
  }

  const cited = [...new Map(included.flatMap((s) => s.citations).map((c) => [c.itemId, c])).values()].sort((a, b) =>
    a.itemId.localeCompare(b.itemId, "en", { numeric: true }),
  );
  if (cited.length > 0) {
    lines.push("", "## Sources", "");
    for (const citation of cited) {
      const item = items[citation.itemId];
      lines.push(
        `- **${citation.itemId}**${item ? ` (${item.section}): ${inline(item.label)}` : ""} · hash \`${citation.itemHash.slice(0, 12)}\``,
      );
    }
  }

  return { markdown: `${lines.join("\n")}\n`, statementIds: included.map((s) => s.id), sections };
}

/**
 * Approval requires every brief condition plus a generated brief that still
 * matches the current review state (re-assembling it must reproduce the same Markdown).
 */
export function approvalBlockers(
  briefBlockersNow: Blocker[],
  storedBrief: { markdown: string } | null,
  currentMarkdown: string | null,
): Blocker[] {
  const blockers = [...briefBlockersNow];
  if (!storedBrief) {
    blockers.push({ code: "BRIEF_MISSING", message: "Generate the final brief for the current version first." });
  } else if (blockers.length === 0 && storedBrief.markdown !== currentMarkdown) {
    blockers.push({
      code: "BRIEF_OUTDATED",
      message: "Statements changed after the brief was generated. Regenerate the brief before deciding.",
    });
  }
  return blockers;
}
