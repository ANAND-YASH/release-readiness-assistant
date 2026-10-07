// Deterministic stand-in for the LLM. It derives realistic analysis and summaries
// from the same structured input the real model receives, so the whole workflow
// (validation, citation checks, persistence, UI) runs without an API key and
// tests are reproducible. Output is returned as JSON text, like a real model.

import type { AnalysisInput, SummariesInput } from "./input";
import type { AnalysisOutput, SummariesOutput } from "./output-schema";
import type { AIProvider, AiRequest, AiResponse } from "./provider";

export const MOCK_MODEL = "mock-v1";

type Coverage = AnalysisInput["facts"]["qaCoverage"][number];

function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

function matchGroups(text: string, groups: string[]): string[] {
  const haystack = text.toLowerCase();
  return groups.filter((group) =>
    group
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3 && word !== "all")
      .some((word) => haystack.includes(word.replace(/s$/, ""))),
  );
}

function verification(c: Coverage | undefined): string {
  if (!c || c.status === "uncovered") return "no QA evidence; not verified";
  const qa = c.qa.map((q) => q.replace(":", ": ").replace("_", " ")).join(", ");
  if (c.status === "verified") return `verified by ${qa}`;
  if (c.status === "partial") return `only partially verified (${qa})`;
  return `not yet verified (${qa})`;
}

function qaIds(c: Coverage | undefined): string[] {
  return c ? c.qa.map((q) => q.split(":")[0]) : [];
}

export function mockAnalysis(input: AnalysisInput): AnalysisOutput {
  const pkg = input.package;
  const coverage = new Map(input.facts.qaCoverage.map((c) => [c.itemId, c]));
  const recorded = input.facts.alreadyRecorded.map((r) => r.content);
  const migIds = pkg.migrationNotes.map((m) => m.id);

  const changeItems = [
    ...pkg.features.map((item) => ({ item, kind: "feature" as const, breaking: false })),
    ...pkg.bugFixes.map((item) => ({ item, kind: "fix" as const, breaking: false })),
    ...pkg.changedBehaviour.map((item) => ({ item, kind: "change" as const, breaking: item.breaking })),
  ];

  const impactClassifications = changeItems.map(({ item, kind, breaking }) => {
    const impact = breaking ? "high" : kind === "fix" ? "low" : "medium";
    const groups = item.userGroups.length ? item.userGroups : matchGroups(`${item.title} ${item.description}`, pkg.affectedUserGroups);
    const c = coverage.get(item.id);
    const why =
      breaking
        ? "Breaking change: affected users or integrations must adapt."
        : kind === "fix"
          ? "Corrects existing behaviour; little change to how users work."
          : kind === "feature"
            ? "Adds a new capability that users can opt into."
            : "Alters existing behaviour users will notice.";
    return {
      itemId: item.id,
      impact,
      userGroups: groups,
      rationale: `${why}${c && c.status !== "verified" ? ` QA status: ${verification(c)}.` : ""}${groups.length === 0 ? " Affected groups are not clear from the package." : ""}`,
    } satisfies AnalysisOutput["impactClassifications"][number];
  });

  const missingInformation = pkg.changedBehaviour
    .filter((item) => item.breaking)
    .map((item) => ({
      description: `No rollback plan or user communication plan is described for breaking change ${item.id} (${item.title}).`,
      relatedItemIds: [item.id],
    }));

  const unsupportedClaims = input.facts.claimCandidates
    .filter((claim) => !recorded.some((content) => content.includes(claim.sentence)))
    .map((claim) => {
      const c = coverage.get(claim.location);
      if (claim.location === "qaSummary") {
        const notPassing = pkg.qaEvidence.filter((qa) => qa.result !== "pass").map((qa) => qa.id);
        return {
          claimText: claim.sentence,
          itemId: null,
          reason: `The QA summary asserts "${claim.phrase}", but no individual QA item establishes it${notPassing.length ? ` and ${notPassing.join(", ")} did not pass` : ""}.`,
          qaItemIds: notPassing.length ? notPassing : pkg.qaEvidence.map((qa) => qa.id),
        };
      }
      const ids = qaIds(c);
      const titles = pkg.qaEvidence.filter((qa) => ids.includes(qa.id)).map((qa) => `${qa.id} "${qa.title}"`);
      return {
        claimText: claim.sentence,
        itemId: claim.location,
        reason: `${titles.length ? titles.join(", ") : "The cited evidence"} verifies the change itself but does not explicitly test "${claim.phrase}".`,
        qaItemIds: ids,
      };
    });

  const risks: AnalysisOutput["risks"] = [];
  for (const { item, breaking } of changeItems) {
    const c = coverage.get(item.id);
    if (c && c.status !== "verified") {
      risks.push({
        description: `${item.id} (${item.title}) ships with ${c.status === "uncovered" ? "no QA evidence" : `incomplete QA (${verification(c)})`}; regressions may reach users.`,
        severity: breaking ? "high" : "medium",
        citations: [item.id, ...qaIds(c)],
      });
    }
    if (breaking) {
      risks.push({
        description: `${item.id} is a breaking change (${item.title}); users and integrations that rely on the old behaviour may be disrupted.`,
        severity: "high",
        citations: [item.id, ...migIds],
      });
    }
  }
  for (const limitation of pkg.knownLimitations) {
    risks.push({
      description: `Known limitation may surprise users: ${limitation.text}`,
      severity: "low",
      citations: [limitation.id],
    });
  }

  return { impactClassifications, missingInformation, unsupportedClaims, risks };
}

export function mockSummaries(input: SummariesInput): SummariesOutput {
  const pkg = input.package;
  const coverage = new Map(input.facts.qaCoverage.map((c) => [c.itemId, c]));
  const technicalSummary: SummariesOutput["technicalSummary"] = [];
  const nonTechnicalSummary: SummariesOutput["nonTechnicalSummary"] = [];

  const items = [
    ...pkg.features.map((item) => ({ item, label: "New", breaking: false })),
    ...pkg.bugFixes.map((item) => ({ item, label: "Fixed", breaking: false })),
    ...pkg.changedBehaviour.map((item) => ({ item, label: "Changed", breaking: item.breaking })),
  ];

  for (const { item, label, breaking } of items) {
    const c = coverage.get(item.id);
    technicalSummary.push({
      content: `${item.id}${breaking ? " (breaking)" : ""}: ${item.title}. ${firstSentence(item.description)} Verification: ${verification(c)}.`,
      citations: [item.id, ...qaIds(c)],
    });
    const caveat = c?.status === "verified" ? "" : " Testing for this is not yet complete.";
    nonTechnicalSummary.push({
      content: breaking
        ? `Action may be needed: ${item.title}. Please check how this affects your team.${caveat}`
        : `${label}: ${item.title}.${caveat}`,
      citations: [item.id],
    });
  }

  for (const note of pkg.migrationNotes) {
    technicalSummary.push({ content: `Operator action (${note.id}): ${note.text}`, citations: [note.id] });
  }
  if (pkg.migrationNotes.length > 0) {
    nonTechnicalSummary.push({
      content: "Administrators may need to update settings before some changes take effect.",
      citations: pkg.migrationNotes.map((m) => m.id),
    });
  }
  for (const limitation of pkg.knownLimitations) {
    technicalSummary.push({ content: `Known limitation (${limitation.id}): ${limitation.text}`, citations: [limitation.id] });
    nonTechnicalSummary.push({ content: `Known limitation: ${limitation.text}`, citations: [limitation.id] });
  }
  return { technicalSummary, nonTechnicalSummary };
}

export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly model = MOCK_MODEL;

  async generate(request: AiRequest): Promise<AiResponse> {
    const output =
      request.task.name === "analysis" ? mockAnalysis(request.task.input) : mockSummaries(request.task.input);
    return { rawText: JSON.stringify(output), model: MOCK_MODEL };
  }
}
