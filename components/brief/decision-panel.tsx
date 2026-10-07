"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircleIcon, CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useReviewer } from "@/components/review/reviewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/client/api-client";

type Pending = "approve" | "reject" | null;

export function DecisionPanel({
  releaseId,
  versionNumber,
  approvalBlockers,
}: {
  releaseId: string;
  versionNumber: number;
  approvalBlockers: { code: string; message: string }[];
}) {
  const router = useRouter();
  const [reviewer] = useReviewer();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<Pending>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const canApprove = approvalBlockers.length === 0;

  function submit(decision: "approve" | "reject") {
    if (!reviewer.trim()) {
      setFeedback({ kind: "error", message: "Enter your reviewer name first." });
      return;
    }
    startTransition(async () => {
      const result = await postJson(`/api/releases/${releaseId}/decision`, {
        decision,
        reviewer: reviewer.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setConfirming(null);
      if (!result.ok) {
        const blockers = (result.error.details as { blockers?: { message: string }[] } | undefined)?.blockers;
        setFeedback({ kind: "error", message: blockers?.length ? blockers.map((b) => b.message).join(" ") : result.error.message });
        return;
      }
      setNote("");
      setFeedback({ kind: "success", message: decision === "approve" ? `Release approved for v${versionNumber}.` : "Release rejected." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="decision-note">Decision note (optional)</Label>
        <Textarea
          id="decision-note"
          rows={2}
          maxLength={2000}
          value={note}
          placeholder="Context for the decision, e.g. conditions or reasons for rejection"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {confirming ? (
        <div
          className={`space-y-2 rounded-md border p-2.5 text-sm ${confirming === "approve" ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40"}`}
        >
          <p>
            {confirming === "approve"
              ? `Approve v${versionNumber} for release as ${reviewer.trim() || "—"}? This records a human approval; nothing is deployed.`
              : `Reject v${versionNumber} as ${reviewer.trim() || "—"}? Nothing is deleted; you can keep reviewing and decide again later.`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirming === "approve" ? "default" : "destructive"}
              disabled={isPending}
              onClick={() => submit(confirming)}
            >
              {isPending && <Loader2Icon className="animate-spin" />}
              {confirming === "approve" ? "Confirm approval" : "Confirm rejection"}
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canApprove} onClick={() => setConfirming("approve")} title={canApprove ? undefined : "Resolve the blockers first"}>
            <CheckIcon /> Approve release
          </Button>
          <Button variant="outline" onClick={() => setConfirming("reject")}>
            <XIcon /> Reject release
          </Button>
        </div>
      )}

      {!canApprove && (
        <div className="space-y-1 text-xs">
          <p className="font-medium text-muted-foreground">Approval is blocked until:</p>
          <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
            {approvalBlockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-1.5 text-sm ${feedback.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {feedback.kind === "error" ? <AlertCircleIcon className="mt-0.5 size-4 shrink-0" /> : <CheckIcon className="mt-0.5 size-4 shrink-0" />}
          {feedback.message}
        </p>
      )}
    </div>
  );
}
