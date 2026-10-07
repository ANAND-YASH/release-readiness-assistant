// Deterministic pre-check that runs before any model call.
//
// It blocks analysis of invalid packages, and turns everything that can be
// derived without a model (QA coverage gaps, thin descriptions, unsupported
// absolute claims in items without passing QA) into RULE statements. The same
// findings are passed to the model as facts, so it does not have to guess them.

import { findAbsoluteClaims } from "@/lib/domain/claims";
import { qaCoverage, type CoverageEntry } from "@/lib/domain/qa-coverage";
import { MIN_DESCRIPTION_LENGTH, validatePackage, type ValidationResult } from "@/lib/domain/validate-package";
import { listChangeItems, type ReleasePackage } from "@/lib/schema/release-package";
import type { DraftStatement } from "./types";

export interface ClaimCandidate {
  /** Item whose text contains the claim, or null for the QA summary. */
  itemId: string | null;
  location: string;
  phrase: string;
  sentence: string;
  /** Coverage of the item making the claim (change items only). */
  coverage: CoverageEntry["status"] | null;
}

export interface PrecheckResult {
  validation: ValidationResult;
  coverage: CoverageEntry[];
  thinItemIds: string[];
  breakingWithoutMigration: string[];
  claimCandidates: ClaimCandidate[];
  ruleStatements: DraftStatement[];
}

function describeQa(entry: CoverageEntry): string {
  return entry.qa.map((q) => `${q.id}: ${q.result.replace("_", " ")}`).join(", ");
}

function findClaimCandidates(pkg: ReleasePackage, coverage: CoverageEntry[]): ClaimCandidate[] {
  const coverageById = new Map(coverage.map((c) => [c.itemId, c.status]));
  const candidates: ClaimCandidate[] = [];
  for (const { item } of listChangeItems(pkg)) {
    for (const match of findAbsoluteClaims(`${item.title}. ${item.description}`)) {
      candidates.push({ itemId: item.id, location: item.id, ...match, coverage: coverageById.get(item.id) ?? null });
    }
  }
  for (const qa of pkg.qaEvidence) {
    for (const match of findAbsoluteClaims(`${qa.title}. ${qa.notes}`)) {
      candidates.push({ itemId: qa.id, location: qa.id, ...match, coverage: null });
    }
  }
  for (const match of findAbsoluteClaims(pkg.qaSummary)) {
    candidates.push({ itemId: null, location: "qaSummary", ...match, coverage: null });
  }
  return candidates;
}

export function runPrecheck(pkg: ReleasePackage): PrecheckResult {
  const validation = validatePackage(pkg);
  const coverage = qaCoverage(pkg);
  const thinItemIds = listChangeItems(pkg)
    .filter(({ item }) => item.description.length < MIN_DESCRIPTION_LENGTH)
    .map(({ item }) => item.id);
  const breakingWithoutMigration = validation.warnings
    .filter((w) => w.code === "BREAKING_CHANGE_NO_MIGRATION" && w.itemId)
    .map((w) => w.itemId!);
  const claimCandidates = findClaimCandidates(pkg, coverage);
  const qaById = new Map(pkg.qaEvidence.map((qa) => [qa.id, qa]));

  const ruleStatements: DraftStatement[] = [];
  const missing = (content: string, citations: string[], metadata: Record<string, unknown>) =>
    ruleStatements.push({ kind: "MISSING_INFO", source: "RULE", level: null, content, citations, metadata });

  for (const entry of coverage) {
    const label = `${entry.itemId} (${entry.title})`;
    const qaIds = entry.qa.map((q) => q.id);
    if (entry.status === "uncovered") {
      missing(`${label} has no QA evidence.`, [entry.itemId], { rule: "QA_UNCOVERED" });
    } else if (entry.status === "not_passed") {
      missing(`${label} is only covered by QA that did not pass (${describeQa(entry)}).`, [entry.itemId, ...qaIds], {
        rule: "QA_NOT_PASSED",
      });
    } else if (entry.status === "partial") {
      missing(`${label} is only partially verified (${describeQa(entry)}).`, [entry.itemId, ...qaIds], {
        rule: "QA_PARTIAL",
      });
    }
  }
  for (const id of thinItemIds) {
    missing(`${id} has a missing or very short description.`, [id], { rule: "THIN_DESCRIPTION" });
  }
  for (const id of breakingWithoutMigration) {
    missing(`${id} is a breaking change but no migration or configuration notes are provided.`, [id], {
      rule: "BREAKING_NO_MIGRATION",
    });
  }

  // Absolute claims are deterministically unsupported when the claiming item
  // lacks passing QA, or when the claim sits in QA evidence that did not pass.
  for (const claim of claimCandidates) {
    if (!claim.itemId) continue;
    const qa = qaById.get(claim.itemId);
    let reason: string | null = null;
    let qaItemIds: string[] = [];
    if (qa && qa.result !== "pass") {
      reason = `${qa.id} reports "${qa.result.replace("_", " ")}", which cannot support "${claim.phrase}".`;
      qaItemIds = [qa.id];
    } else if (!qa && claim.coverage && claim.coverage !== "verified") {
      const entry = coverage.find((c) => c.itemId === claim.itemId)!;
      qaItemIds = entry.qa.map((q) => q.id);
      reason =
        entry.status === "uncovered"
          ? `No QA evidence covers ${claim.itemId}, so "${claim.phrase}" is unverified.`
          : `QA for ${claim.itemId} did not fully pass (${describeQa(entry)}), so "${claim.phrase}" is unverified.`;
    }
    if (reason) {
      ruleStatements.push({
        kind: "UNSUPPORTED_CLAIM",
        source: "RULE",
        level: null,
        content: `Unsupported claim in ${claim.itemId}: "${claim.sentence}" ${reason}`,
        citations: [claim.itemId, ...qaItemIds.filter((id) => id !== claim.itemId)],
        metadata: { claimText: claim.sentence, reason, itemId: claim.itemId, qaItemIds, rule: "ABSOLUTE_CLAIM" },
      });
    }
  }

  return { validation, coverage, thinItemIds, breakingWithoutMigration, claimCandidates, ruleStatements };
}
