// Builds the model input from a version snapshot and the deterministic pre-check.
// Only release data is included: no database IDs, hashes, or configuration.

import type { ReleasePackage } from "@/lib/schema/release-package";
import type { DraftStatement } from "./types";
import type { PrecheckResult } from "./precheck";

export interface AnalysisInput {
  release: { name: string; product: string; versionNumber: number };
  package: ReleasePackage;
  facts: {
    qaCoverage: { itemId: string; status: string; qa: string[] }[];
    claimCandidates: { location: string; sentence: string; phrase: string }[];
    alreadyRecorded: { kind: string; content: string }[];
    validationWarnings: string[];
  };
}

export interface SummariesInput extends AnalysisInput {
  analysis: {
    impact: { itemId: string; impact: string; userGroups: string[] }[];
    unsupportedClaims: { claimText: string; reason: string; citations: string[] }[];
    risks: { description: string; severity: string; citations: string[] }[];
    missingInformation: string[];
  };
}

export function buildAnalysisInput(
  release: { name: string; product: string },
  versionNumber: number,
  pkg: ReleasePackage,
  precheck: PrecheckResult,
): AnalysisInput {
  return {
    release: { name: release.name, product: release.product, versionNumber },
    package: pkg,
    facts: {
      qaCoverage: precheck.coverage.map((c) => ({
        itemId: c.itemId,
        status: c.status,
        qa: c.qa.map((q) => `${q.id}:${q.result}`),
      })),
      claimCandidates: precheck.claimCandidates.map(({ location, sentence, phrase }) => ({ location, sentence, phrase })),
      alreadyRecorded: precheck.ruleStatements.map((s) => ({ kind: s.kind, content: s.content })),
      validationWarnings: precheck.validation.warnings.map((w) => w.message),
    },
  };
}

export function buildSummariesInput(base: AnalysisInput, statements: DraftStatement[]): SummariesInput {
  const of = (kind: DraftStatement["kind"]) => statements.filter((s) => s.kind === kind);
  return {
    ...base,
    analysis: {
      impact: of("IMPACT").map((s) => ({
        itemId: s.citations[0],
        impact: s.level ?? "unknown",
        userGroups: (s.metadata?.userGroups as string[]) ?? [],
      })),
      unsupportedClaims: of("UNSUPPORTED_CLAIM").map((s) => ({
        claimText: String(s.metadata?.claimText ?? ""),
        reason: String(s.metadata?.reason ?? s.content),
        citations: s.citations,
      })),
      risks: of("RISK").map((s) => ({ description: s.content, severity: s.level ?? "unknown", citations: s.citations })),
      missingInformation: of("MISSING_INFO").map((s) => s.content),
    },
  };
}
