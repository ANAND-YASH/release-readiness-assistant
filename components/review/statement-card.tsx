"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircleIcon, CheckCircle2Icon, CheckIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestJson } from "@/lib/client/api-client";
import { ALLOWED_ACTIONS, type ReviewAction } from "@/lib/domain/review";
import { formatDateTime } from "@/lib/format";
import type { StatementKind } from "@/lib/generated/prisma/enums";
import type { StaleResult } from "@/lib/domain/staleness";
import type { StatementDto } from "@/lib/services/analysis";
import { cn } from "@/lib/utils";
import { useReviewer } from "./reviewer";

export interface CitableItem {
  label: string;
  section: string;
}

const KIND_LABEL: Record<StatementKind, string> = {
  IMPACT: "Impact",
  MISSING_INFO: "Missing information",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  RISK: "Risk",
  TECH_SUMMARY: "Technical summary",
  NONTECH_SUMMARY: "Non-technical summary",
};

const LEVEL_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  none: "bg-muted text-muted-foreground",
};

const REVIEW_STYLE: Record<StatementDto["reviewStatus"], { label: string; className: string }> = {
  PENDING: { label: "Pending review", className: "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300" },
  APPROVED: { label: "Approved", className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  EDITED: { label: "Edited", className: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  REJECTED: { label: "Rejected", className: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const SUCCESS: Record<ReviewAction, string> = {
  approve: "Statement approved.",
  reject: "Statement rejected.",
  edit: "Edit saved. The original generated text is kept.",
};

type Mode = "view" | "edit" | "approve" | "reject";
type Feedback = { kind: "success" | "error"; message: string; requestId?: string } | null;

function CitationChip({
  itemId,
  itemHash,
  item,
  changed,
}: {
  itemId: string;
  itemHash: string;
  item?: CitableItem;
  changed: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[0.7rem]",
        changed
          ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-200"
          : "bg-muted/50 text-muted-foreground",
      )}
      title={`${item ? `${item.section}: ${item.label}` : "Unknown item"}\nhash at generation ${itemHash.slice(0, 12)}${changed ? "\nchanged since generation" : ""}`}
    >
      {itemId}
    </span>
  );
}

function GeneratedContent({ statement }: { statement: StatementDto }) {
  const claim = statement.kind === "UNSUPPORTED_CLAIM" ? statement.metadata : null;
  if (claim) {
    return (
      <div className="space-y-1.5 text-sm">
        <blockquote className="border-l-2 border-amber-400 pl-3 italic">“{String(claim.claimText)}”</blockquote>
        <p className="text-muted-foreground">{String(claim.reason)}</p>
      </div>
    );
  }
  return <p className="text-sm whitespace-pre-line">{statement.aiContent}</p>;
}

export function StatementCard({
  statement,
  items,
  stale,
  currentVersionNumber,
}: {
  statement: StatementDto;
  items: Record<string, CitableItem>;
  /** Staleness relative to the release's current version. */
  stale: StaleResult;
  currentVersionNumber: number;
}) {
  const router = useRouter();
  const [reviewer] = useReviewer();
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState(statement.content);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  const status = statement.reviewStatus;
  // Stale statements cite evidence that has since changed: they can only be rejected
  // (the server enforces the same rule) until analysis is re-run.
  const allowed = ALLOWED_ACTIONS[status].filter((action) => !stale.stale || action === "reject");
  const review = REVIEW_STYLE[status];
  const hasReviewer = reviewer.trim() !== "";
  const generatedBy = statement.source === "RULE" ? "deterministic check" : "AI";

  function open(next: Mode) {
    setFeedback(null);
    if (next === "edit") setDraft(statement.content);
    if (next === "reject") setNote("");
    setMode(next);
  }

  function submit(body: { action: "approve" } | { action: "reject"; note?: string } | { action: "edit"; content: string }) {
    if (!hasReviewer) {
      setFeedback({ kind: "error", message: "Enter your reviewer name at the top of the page first." });
      return;
    }
    startTransition(async () => {
      const result = await requestJson<StatementDto>("PATCH", `/api/statements/${statement.id}`, {
        ...body,
        reviewer: reviewer.trim(),
      });
      if (result.ok) {
        setMode("view");
        setFeedback({ kind: "success", message: SUCCESS[body.action] });
        router.refresh();
      } else {
        setFeedback({ kind: "error", message: result.error.message, requestId: result.error.requestId });
      }
    });
  }

  return (
    <li
      className={cn("space-y-2.5 rounded-lg border p-3", status === "REJECTED" && "bg-muted/40")}
      data-statement-id={statement.id}
      data-review-status={status}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{KIND_LABEL[statement.kind]}</span>
        {statement.level && (
          <Badge className={cn("rounded-md capitalize", LEVEL_STYLE[statement.level] ?? LEVEL_STYLE.none)}>
            {statement.level}
          </Badge>
        )}
        <Badge variant="outline" className="rounded-md" title={`Produced by ${generatedBy}`}>
          {statement.source === "RULE" ? "Rule" : "AI"}
        </Badge>
        {stale.stale && (
          <Badge className="rounded-md bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            STALE
          </Badge>
        )}
        <Badge variant="outline" className={cn("ml-auto rounded-md", review.className)} data-testid="review-status">
          {review.label}
        </Badge>
      </div>

      <div className={cn(status === "REJECTED" && "text-muted-foreground line-through decoration-muted-foreground/40")}>
        {statement.editedContent ? (
          <div className="space-y-1.5">
            <p className="text-sm whitespace-pre-line" data-testid="effective-content">
              {statement.editedContent}
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Original {generatedBy} content (preserved)</summary>
              <div className="mt-1.5 rounded-md border bg-muted/40 p-2" data-testid="original-content">
                <GeneratedContent statement={statement} />
              </div>
            </details>
          </div>
        ) : (
          <GeneratedContent statement={statement} />
        )}
      </div>

      {statement.citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Sources:</span>
          {statement.citations.map((citation) => (
            <CitationChip
              key={citation.itemId}
              {...citation}
              item={items[citation.itemId]}
              changed={stale.reasons.some((r) => r.startsWith(`${citation.itemId} `) || r.endsWith(` ${citation.itemId} changed`))}
            />
          ))}
        </div>
      )}

      {stale.stale && (
        <div
          className="rounded-md border border-orange-300 bg-orange-50/70 px-2.5 py-1.5 text-xs text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
          data-testid="stale-reason"
        >
          <span className="font-semibold">STALE</span> — {stale.reasons.join("; ")}. This statement no longer matches
          v{currentVersionNumber} and must be regenerated (re-run analysis) before it can be used; it can only be
          rejected.
        </div>
      )}

      {statement.reviewedBy && statement.reviewedAt && (
        <p className="text-xs text-muted-foreground" data-testid="reviewed-by">
          {review.label} by <span className="font-medium text-foreground">{statement.reviewedBy}</span> ·{" "}
          {formatDateTime(statement.reviewedAt)}
          {statement.reviewNote && <> · Note: “{statement.reviewNote}”</>}
        </p>
      )}

      {mode === "edit" && (
        <div className="space-y-2 rounded-md border bg-background p-2.5">
          <Label htmlFor={`edit-${statement.id}`}>Edit statement</Label>
          <Textarea
            id={`edit-${statement.id}`}
            rows={4}
            value={draft}
            aria-invalid={draft.trim() === ""}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draft.trim() === "" && <p className="text-xs text-destructive">Edited content cannot be empty.</p>}
          <p className="text-xs text-muted-foreground">The original generated text is kept alongside your edit.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isPending || draft.trim() === "" || draft.trim() === statement.content}
              onClick={() => submit({ action: "edit", content: draft.trim() })}
            >
              {isPending && <Loader2Icon className="animate-spin" />} Save changes
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "approve" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 p-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <span>
            Approve this statement as <strong>{reviewer.trim() || "—"}</strong>?
          </span>
          <Button size="sm" disabled={isPending} onClick={() => submit({ action: "approve" })}>
            {isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Confirm approve
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => setMode("view")}>
            Cancel
          </Button>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-2 rounded-md border border-red-300 bg-red-50/60 p-2.5 text-sm dark:border-red-900 dark:bg-red-950/40">
          <p>
            Reject this statement as <strong>{reviewer.trim() || "—"}</strong>? It will be excluded from the brief; you
            can still edit or approve it later.
          </p>
          <Label htmlFor={`note-${statement.id}`} className="text-xs font-normal">
            Rejection note (optional)
          </Label>
          <Textarea
            id={`note-${statement.id}`}
            rows={2}
            value={note}
            maxLength={1000}
            placeholder="Why is this statement wrong or not needed?"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={() => submit({ action: "reject", ...(note.trim() ? { note: note.trim() } : {}) })}
            >
              {isPending ? <Loader2Icon className="animate-spin" /> : <XIcon />} Confirm reject
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "view" && allowed.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allowed.includes("edit") && (
            <Button size="xs" variant="outline" onClick={() => open("edit")}>
              <PencilIcon /> {status === "EDITED" ? "Edit again" : "Edit"}
            </Button>
          )}
          {allowed.includes("approve") && (
            <Button size="xs" variant="outline" onClick={() => open("approve")}>
              <CheckIcon /> Approve
            </Button>
          )}
          {allowed.includes("reject") && (
            <Button size="xs" variant="outline" onClick={() => open("reject")}>
              <XIcon /> Reject
            </Button>
          )}
        </div>
      )}

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-1.5 text-xs",
            feedback.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {feedback.kind === "error" ? (
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
          ) : (
            <CheckCircle2Icon className="mt-px size-3.5 shrink-0" />
          )}
          <span>
            {feedback.message}
            {feedback.requestId && <span className="ml-1 font-mono">({feedback.requestId})</span>}
          </span>
        </p>
      )}
    </li>
  );
}
