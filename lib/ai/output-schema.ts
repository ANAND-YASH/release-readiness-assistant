// Structured output contracts for the model. The same Zod schemas generate the
// strict JSON schema sent to OpenAI and validate every response (mock included).

import { z } from "zod";

export const IMPACT_LEVELS = ["high", "medium", "low", "none"] as const;
export const RISK_SEVERITIES = ["high", "medium", "low"] as const;

export const AnalysisOutputSchema = z.object({
  impactClassifications: z.array(
    z.object({
      itemId: z.string(),
      impact: z.enum(IMPACT_LEVELS),
      userGroups: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  missingInformation: z.array(
    z.object({
      description: z.string(),
      relatedItemIds: z.array(z.string()),
    }),
  ),
  unsupportedClaims: z.array(
    z.object({
      claimText: z.string(),
      /** Item whose text makes the claim; null when the claim is in the QA summary. */
      itemId: z.string().nullable(),
      reason: z.string(),
      qaItemIds: z.array(z.string()),
    }),
  ),
  risks: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(RISK_SEVERITIES),
      citations: z.array(z.string()),
    }),
  ),
});

const SummaryStatement = z.object({
  content: z.string(),
  citations: z.array(z.string()),
});

export const SummariesOutputSchema = z.object({
  technicalSummary: z.array(SummaryStatement),
  nonTechnicalSummary: z.array(SummaryStatement),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
export type SummariesOutput = z.infer<typeof SummariesOutputSchema>;
