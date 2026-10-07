// Human review of generated statements: allowed transitions, request schema and
// summary counts. Pure, so the rules are unit-tested independently of the API.

import { z } from "zod";
import type { ReviewStatus } from "@/lib/generated/prisma/enums";

export const REVIEW_ACTIONS = ["approve", "reject", "edit"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

const reviewer = z
  .string({ error: "Reviewer name is required" })
  .trim()
  .min(1, "Reviewer name is required")
  .max(100, "Reviewer name is too long");

export const ReviewRequestSchema = z.discriminatedUnion(
  "action",
  [
    z.object({ action: z.literal("approve"), reviewer }),
    z.object({
      action: z.literal("reject"),
      reviewer,
      note: z.string().trim().max(1000, "Note is too long").optional(),
    }),
    z.object({
      action: z.literal("edit"),
      reviewer,
      content: z
        .string({ error: "Edited content is required" })
        .trim()
        .min(1, "Edited content cannot be empty")
        .max(5000, "Edited content is too long"),
    }),
  ],
  { error: 'action must be "approve", "reject" or "edit"' },
);

export type ReviewRequest = z.output<typeof ReviewRequestSchema>;

const TARGET: Record<ReviewAction, ReviewStatus> = { approve: "APPROVED", reject: "REJECTED", edit: "EDITED" };

/**
 * Allowed actions per status. Every decision is reversible; the only refused
 * transitions are no-ops (approving an approved statement, rejecting a rejected one).
 */
export const ALLOWED_ACTIONS: Record<ReviewStatus, readonly ReviewAction[]> = {
  PENDING: ["edit", "approve", "reject"],
  APPROVED: ["edit", "reject"],
  EDITED: ["edit", "approve", "reject"],
  REJECTED: ["edit", "approve"],
};

export function nextReviewStatus(
  current: ReviewStatus,
  action: ReviewAction,
): { ok: true; status: ReviewStatus } | { ok: false; reason: string } {
  if (!ALLOWED_ACTIONS[current].includes(action)) {
    return { ok: false, reason: `Cannot ${action} a statement that is already ${current.toLowerCase()}.` };
  }
  return { ok: true, status: TARGET[action] };
}

export interface ReviewSummary {
  total: number;
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
  /** Populated by staleness detection in a later step. */
  stale: number;
  reviewed: number;
  allReviewed: boolean;
}

export function summarizeReview(statements: { reviewStatus: ReviewStatus; stale?: boolean }[]): ReviewSummary {
  const count = (status: ReviewStatus) => statements.filter((s) => s.reviewStatus === status).length;
  const pending = count("PENDING");
  return {
    total: statements.length,
    pending,
    approved: count("APPROVED"),
    edited: count("EDITED"),
    rejected: count("REJECTED"),
    stale: statements.filter((s) => s.stale).length,
    reviewed: statements.length - pending,
    allReviewed: statements.length > 0 && pending === 0,
  };
}
