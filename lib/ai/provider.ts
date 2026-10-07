// Provider abstraction. Providers only produce raw text; parsing, validation,
// retries and citation checks happen in run-analysis.ts so every provider is
// held to the same contract.

import type { z } from "zod";
import type { AnalysisInput, SummariesInput } from "./input";

export type AiTask =
  | { name: "analysis"; input: AnalysisInput }
  | { name: "summaries"; input: SummariesInput };

export interface AiRequest {
  task: AiTask;
  system: string;
  user: string;
  /** Name and Zod schema of the expected structured output. */
  schemaName: string;
  schema: z.ZodType;
  /** Set on the single retry: the rejected output and why it was rejected. */
  retry?: { previousOutput: string; error: string };
}

export interface AiResponse {
  rawText: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AIProvider {
  readonly name: "openai" | "mock" | (string & {});
  readonly model: string;
  generate(request: AiRequest): Promise<AiResponse>;
}

/** Thrown for provider failures that are not about output shape (network, auth, refusal). */
export class AiProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiProviderError";
  }
}
