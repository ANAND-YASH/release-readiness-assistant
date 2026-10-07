import { z } from "zod";

const reviewer = z
  .string({ error: "Reviewer name is required" })
  .trim()
  .min(1, "Reviewer name is required")
  .max(100, "Reviewer name is too long");

export const DecisionRequestSchema = z.object({
  decision: z.enum(["approve", "reject"], { error: 'decision must be "approve" or "reject"' }),
  reviewer,
  note: z.string().trim().max(2000, "Note is too long").optional(),
});

export const BriefRequestSchema = z.object({ reviewer });

export type DecisionRequest = z.output<typeof DecisionRequestSchema>;
