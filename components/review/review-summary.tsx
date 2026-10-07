import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { ReviewSummary } from "@/lib/domain/review";
import type { AnalysisRunDto } from "@/lib/services/analysis";
import { cn } from "@/lib/utils";

const RUN_LABEL: Record<AnalysisRunDto["status"], string> = {
  RUNNING: "Running",
  SUCCEEDED: "Completed",
  FAILED: "Failed",
};

function Tile({ label, value, className, title }: { label: string; value: string | number; className?: string; title?: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2" title={title} data-testid={`summary-${label.toLowerCase()}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

export function ReviewSummaryPanel({ summary, latestRun }: { summary: ReviewSummary; latestRun: AnalysisRunDto | null }) {
  return (
    <Card className="mb-6">
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Tile label="Total" value={summary.total} />
          <Tile label="Pending" value={summary.pending} className={summary.pending > 0 ? "text-amber-700 dark:text-amber-400" : undefined} />
          <Tile label="Approved" value={summary.approved} className="text-emerald-700 dark:text-emerald-400" />
          <Tile label="Edited" value={summary.edited} className="text-blue-700 dark:text-blue-400" />
          <Tile label="Rejected" value={summary.rejected} className="text-red-700 dark:text-red-400" />
          <Tile
            label="Stale"
            value={summary.stale}
            title="Statements whose cited items changed in the current version"
            className={summary.stale > 0 ? "text-orange-700 dark:text-orange-400" : undefined}
          />
          <Tile label="Analysis" value={latestRun ? RUN_LABEL[latestRun.status] : "Not run"} className="text-base leading-7" />
        </div>
        {summary.stale > 0 && (
          <Alert className="border-orange-300 dark:border-orange-900">
            <AlertTriangleIcon className="text-orange-600" />
            <AlertTitle>{summary.stale} stale statement{summary.stale === 1 ? "" : "s"} must be regenerated</AlertTitle>
            <AlertDescription>
              The release package changed after these statements were generated, so the evidence they cite no longer
              matches. Stale statements cannot be approved or used in the final brief; re-run analysis for the current
              version, then review the new statements.
            </AlertDescription>
          </Alert>
        )}
        {summary.total > 0 &&
          (summary.allReviewed ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>All {summary.total} statements have been reviewed</AlertTitle>
              <AlertDescription>
                Rejected statements will be left out of the final brief. Generating the brief and the release decision
                are separate human steps, available later.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <InfoIcon />
              <AlertTitle>All statements must be reviewed before a final brief can be generated</AlertTitle>
              <AlertDescription>
                {summary.pending} of {summary.total} statements are still pending. Approve, edit or reject each one.
              </AlertDescription>
            </Alert>
          ))}
      </CardContent>
    </Card>
  );
}
