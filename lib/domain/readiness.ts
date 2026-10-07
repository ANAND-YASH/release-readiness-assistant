// Readiness checklist shown on the release overview. Items that depend on
// workflow steps not built yet are reported as "pending".

import type { ReviewSummary } from "@/lib/domain/review";
import type { ValidationCode, ValidationResult } from "@/lib/domain/validate-package";

export type ChecklistState = "done" | "attention" | "pending";

export interface ChecklistItem {
  key: string;
  label: string;
  state: ChecklistState;
  detail: string;
}

const COVERAGE_CODES: ValidationCode[] = ["ITEM_NO_QA_COVERAGE", "QA_EVIDENCE_EMPTY"];

/** Status of the latest AI analysis run for the version, if any. */
export type AnalysisState = "none" | "RUNNING" | "SUCCEEDED" | "FAILED";

export function readinessChecklist(
  validation: ValidationResult,
  analysis: AnalysisState = "none",
  review?: ReviewSummary,
  /** Set when the statements under review were generated for an earlier version. */
  carriedFrom: number | null = null,
  final?: {
    brief: "none" | "outdated" | "current";
    /** Human decision, if it was made for the current version. */
    decision: "APPROVED" | "REJECTED" | null;
  },
): ChecklistItem[] {
  const count = (codes: ValidationCode[]) => validation.warnings.filter((w) => codes.includes(w.code)).length;
  const uncovered = count(COVERAGE_CODES);
  const notPassed = count(["QA_NOT_PASSED"]);
  const otherWarnings = validation.warnings.length - uncovered - notPassed;

  return [
    {
      key: "validation",
      label: "Required release information complete",
      state: validation.valid ? "done" : "attention",
      detail: validation.valid
        ? "No blocking validation errors."
        : `${validation.errors.length} blocking error(s).`,
    },
    {
      key: "qa-coverage",
      label: "Every change is backed by QA evidence",
      state: uncovered === 0 ? "done" : "attention",
      detail: uncovered === 0 ? "All changes are linked to QA evidence." : `${uncovered} coverage gap(s).`,
    },
    {
      key: "qa-results",
      label: "All QA evidence passed",
      state: notPassed === 0 ? "done" : "attention",
      detail: notPassed === 0 ? "No failed, partial or unrun QA." : `${notPassed} QA item(s) did not pass.`,
    },
    {
      key: "other-warnings",
      label: "No other validation warnings",
      state: otherWarnings === 0 ? "done" : "attention",
      detail: otherWarnings === 0 ? "Nothing else flagged." : `${otherWarnings} warning(s) to review.`,
    },
    {
      key: "analysis",
      label: "AI analysis generated",
      state: analysis === "SUCCEEDED" ? "done" : analysis === "FAILED" || carriedFrom !== null ? "attention" : "pending",
      detail:
        analysis === "SUCCEEDED"
          ? "Statements are waiting for human review."
          : analysis === "FAILED"
            ? "The latest analysis run failed; re-run it from Review."
            : analysis === "RUNNING"
              ? "Analysis is running."
              : carriedFrom !== null
                ? `Latest analysis is for v${carriedFrom}; re-run it for this version.`
                : "Run AI analysis from the Review page.",
    },
    {
      key: "freshness",
      label: "No stale statements",
      state: !review || review.total === 0 ? "pending" : review.stale === 0 ? "done" : "attention",
      detail:
        !review || review.total === 0
          ? "Nothing to check yet."
          : review.stale === 0
            ? "All statements match the current package."
            : `${review.stale} statement(s) cite items that changed; re-run analysis to regenerate them.`,
    },
    {
      key: "review",
      label: "AI statements reviewed",
      state: !review || review.total === 0 ? "pending" : review.allReviewed ? "done" : "attention",
      detail:
        !review || review.total === 0
          ? "Nothing to review yet."
          : review.allReviewed
            ? `All ${review.total} statements reviewed (${review.rejected} rejected).`
            : `${review.pending} of ${review.total} statements still pending.`,
    },
    {
      key: "brief",
      label: "Final brief generated",
      state: !final || final.brief === "none" ? "pending" : final.brief === "current" ? "done" : "attention",
      detail:
        !final || final.brief === "none"
          ? "Generate it on the Brief page once every statement is reviewed."
          : final.brief === "current"
            ? "Up to date with the reviewed statements."
            : "Reviews changed since it was generated; regenerate it.",
    },
    {
      key: "decision",
      label: "Human release decision",
      state: final?.decision === "APPROVED" ? "done" : final?.decision === "REJECTED" ? "attention" : "pending",
      detail:
        final?.decision === "APPROVED"
          ? "Approved by a reviewer."
          : final?.decision === "REJECTED"
            ? "Rejected by a reviewer; address the note and decide again."
            : "Approve or reject on the Brief page.",
    },
  ];
}
