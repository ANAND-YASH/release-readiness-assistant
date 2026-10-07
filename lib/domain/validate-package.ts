// Deterministic release-package validation.
//
// Errors block AI analysis and release approval. Warnings are surfaced to the
// reviewer but do not block. Input must already satisfy ReleasePackageSchema;
// this module checks completeness and consistency, not shape.

import {
  listChangeItems,
  listItems,
  type ReleasePackage,
} from "@/lib/schema/release-package";

export const VALIDATION_CODES = [
  // errors
  "NO_CHANGE_ITEMS",
  "QA_SUMMARY_MISSING",
  "USER_GROUPS_MISSING",
  "LIMITATIONS_MISSING",
  "MIGRATION_NOTES_MISSING",
  "NONE_DECLARED_CONFLICT",
  "DUPLICATE_ITEM_ID",
  "ITEM_TITLE_MISSING",
  "EMPTY_ENTRY",
  "QA_UNKNOWN_COVERED_ITEM",
  // history-dependent; checked by the release service against earlier versions
  "ITEM_ID_REUSED",
  // warnings
  "QA_EVIDENCE_EMPTY",
  "ITEM_NO_QA_COVERAGE",
  "QA_NOT_PASSED",
  "QA_COVERS_NOTHING",
  "BREAKING_CHANGE_NO_MIGRATION",
  "DESCRIPTION_TOO_SHORT",
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];
export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  code: ValidationCode;
  severity: IssueSeverity;
  /** Dotted path into the package, e.g. "features[0].title". */
  path: string;
  message: string;
  itemId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export const MIN_DESCRIPTION_LENGTH = 20;

const OPTIONAL_LIST_SECTIONS = [
  { section: "knownLimitations", label: "known limitations", missingCode: "LIMITATIONS_MISSING" },
  { section: "migrationNotes", label: "migration/configuration notes", missingCode: "MIGRATION_NOTES_MISSING" },
] as const;

export function validatePackage(pkg: ReleasePackage): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, path: string, message: string, itemId?: string) =>
    issues.push({ code, severity: "error", path, message, ...(itemId ? { itemId } : {}) });
  const warning = (code: ValidationCode, path: string, message: string, itemId?: string) =>
    issues.push({ code, severity: "warning", path, message, ...(itemId ? { itemId } : {}) });

  const changeItems = listChangeItems(pkg);
  const changeIds = new Set(changeItems.map(({ item }) => item.id));

  // --- Required sections -------------------------------------------------
  if (changeItems.length === 0) {
    error("NO_CHANGE_ITEMS", "features", "Add at least one completed feature, bug fix, or changed behaviour.");
  }
  if (pkg.qaSummary === "") {
    error("QA_SUMMARY_MISSING", "qaSummary", "QA summary is required.");
  }
  if (pkg.affectedUserGroups.every((group) => group === "")) {
    error("USER_GROUPS_MISSING", "affectedUserGroups", "List at least one affected user group.");
  }
  pkg.affectedUserGroups.forEach((group, i) => {
    if (group === "" && pkg.affectedUserGroups.length > 1) {
      error("EMPTY_ENTRY", `affectedUserGroups[${i}]`, "User group cannot be empty.");
    }
  });

  for (const { section, label, missingCode } of OPTIONAL_LIST_SECTIONS) {
    const hasItems = pkg[section].length > 0;
    const declaredNone = pkg.noneDeclared[section];
    if (!hasItems && !declaredNone) {
      error(missingCode, section, `Add ${label} or explicitly declare that there are none.`);
    } else if (hasItems && declaredNone) {
      error("NONE_DECLARED_CONFLICT", section, `"None" is declared for ${label}, but entries were provided.`);
    }
    pkg[section].forEach((entry, i) => {
      if (entry.text === "") error("EMPTY_ENTRY", `${section}[${i}].text`, "Entry text cannot be empty.", entry.id);
    });
  }

  // --- Item identity -----------------------------------------------------
  const seen = new Map<string, string>();
  for (const { section, index, item } of listItems(pkg)) {
    const path = `${section}[${index}]`;
    const firstPath = seen.get(item.id);
    if (firstPath) {
      error("DUPLICATE_ITEM_ID", `${path}.id`, `Item ID ${item.id} is also used at ${firstPath}.`, item.id);
    } else {
      seen.set(item.id, path);
    }
  }

  // --- Change items ------------------------------------------------------
  for (const { section, index, item } of changeItems) {
    const path = `${section}[${index}]`;
    if (item.title === "") {
      error("ITEM_TITLE_MISSING", `${path}.title`, `${item.id} needs a title.`, item.id);
    }
    if (item.description.length < MIN_DESCRIPTION_LENGTH) {
      warning(
        "DESCRIPTION_TOO_SHORT",
        `${path}.description`,
        `${item.id} has a missing or very short description; generated summaries may be vague.`,
        item.id,
      );
    }
  }

  // --- QA evidence -------------------------------------------------------
  const coveredIds = new Set<string>();
  pkg.qaEvidence.forEach((qa, i) => {
    const path = `qaEvidence[${i}]`;
    if (qa.title === "") error("ITEM_TITLE_MISSING", `${path}.title`, `${qa.id} needs a title.`, qa.id);
    if (qa.result !== "pass") {
      warning("QA_NOT_PASSED", `${path}.result`, `${qa.id} result is "${qa.result}".`, qa.id);
    }
    if (qa.coversItemIds.length === 0) {
      warning("QA_COVERS_NOTHING", `${path}.coversItemIds`, `${qa.id} is not linked to any change item.`, qa.id);
    }
    qa.coversItemIds.forEach((coveredId, j) => {
      if (changeIds.has(coveredId)) {
        coveredIds.add(coveredId);
      } else {
        error(
          "QA_UNKNOWN_COVERED_ITEM",
          `${path}.coversItemIds[${j}]`,
          `${qa.id} references ${coveredId}, which is not a feature, bug fix, or changed behaviour in this package.`,
          qa.id,
        );
      }
    });
  });

  if (changeItems.length > 0 && pkg.qaEvidence.length === 0) {
    warning("QA_EVIDENCE_EMPTY", "qaEvidence", "No itemised QA evidence; no change can be verified against QA.");
  } else {
    for (const { section, index, item } of changeItems) {
      if (!coveredIds.has(item.id)) {
        warning("ITEM_NO_QA_COVERAGE", `${section}[${index}]`, `${item.id} is not covered by any QA evidence.`, item.id);
      }
    }
  }

  // --- Cross-section consistency -----------------------------------------
  if (pkg.migrationNotes.length === 0) {
    pkg.changedBehaviour.forEach((item, i) => {
      if (item.breaking) {
        warning(
          "BREAKING_CHANGE_NO_MIGRATION",
          `changedBehaviour[${i}]`,
          `${item.id} is marked breaking but there are no migration/configuration notes.`,
          item.id,
        );
      }
    });
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { valid: errors.length === 0, errors, warnings };
}
