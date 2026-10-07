"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircleIcon, Loader2Icon, RotateCwIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { postJson, type ClientApiError } from "@/lib/client/api-client";

interface Props {
  releaseId: string;
  versionNumber: number;
  /** Blocking validation errors prevent analysis. */
  blocked: boolean;
  hasAnalysis: boolean;
  /** Statements of the current run that a human has already reviewed. */
  reviewedCount: number;
  /** Error message of the latest run if it failed (from the server render). */
  lastRunError: string | null;
}

export function RunAnalysisPanel({ releaseId, versionNumber, blocked, hasAnalysis, reviewedCount, lastRunError }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  async function run() {
    setConfirming(false);
    setRunning(true);
    setElapsed(0);
    setError(null);
    const result = await postJson(`/api/releases/${releaseId}/versions/${versionNumber}/analyze`);
    setRunning(false);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  const failure = error ?? (lastRunError ? { code: "ANALYSIS_FAILED", message: lastRunError } : null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => (hasAnalysis && reviewedCount > 0 ? setConfirming(true) : run())}
          disabled={running || blocked || confirming}
        >
          {running ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {running ? "Analysing…" : hasAnalysis ? "Re-run AI analysis" : "Run AI analysis"}
        </Button>
        {running && (
          <span className="text-sm text-muted-foreground" aria-live="polite">
            Running deterministic checks and AI analysis… {elapsed}s
          </span>
        )}
        {blocked && !running && (
          <span className="text-sm text-destructive">Fix the blocking validation errors before running analysis.</span>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span>
            {reviewedCount} statement{reviewedCount === 1 ? " has" : "s have"} already been reviewed. Re-running creates a
            new set of PENDING statements and the current reviews will no longer be shown. Continue?
          </span>
          <Button size="sm" onClick={run}>
            Re-run analysis
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      {hasAnalysis && !running && !confirming && (
        <p className="text-xs text-muted-foreground">
          Re-running creates a new set of PENDING statements; previous runs are kept.
        </p>
      )}
      {failure && !running && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{failure.code === "ANALYSIS_BLOCKED" ? "Analysis blocked" : "Analysis failed"}</AlertTitle>
          <AlertDescription>
            <p>{failure.message}</p>
            {failure.requestId && <p className="font-mono text-xs">Request ID: {failure.requestId}</p>}
            {!blocked && failure.code !== "ANALYSIS_BLOCKED" && (
              <Button variant="outline" size="sm" className="mt-2" onClick={run}>
                <RotateCwIcon /> Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
