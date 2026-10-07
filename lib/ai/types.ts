import type { StatementKind } from "@/lib/generated/prisma/enums";

export type StatementSource = "RULE" | "AI";

/** A statement after validation, before persistence. Citations are item IDs from the analysed version. */
export interface DraftStatement {
  kind: StatementKind;
  source: StatementSource;
  /** impact (IMPACT) or severity (RISK) */
  level: string | null;
  content: string;
  citations: string[];
  metadata?: Record<string, unknown>;
}

export interface Citation {
  itemId: string;
  itemHash: string;
}

/** Something removed from model output, recorded for logs and the run record. */
export interface DroppedOutput {
  kind: StatementKind;
  reason: "unknown_item" | "invalid_citation" | "missing_citation" | "unhedged_claim" | "duplicate" | "empty";
  detail: string;
  ids?: string[];
}
