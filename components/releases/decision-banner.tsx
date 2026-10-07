import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import type { ReleaseSummary } from "@/lib/services/releases";

/** Shows the human release decision, if any, and whether it covers the current version. */
export function DecisionBanner({ release, currentVersionNumber }: { release: ReleaseSummary; currentVersionNumber: number }) {
  const decision = release.decision;
  if (!decision || (release.status !== "APPROVED" && release.status !== "REJECTED")) return null;
  const approved = release.status === "APPROVED";
  const olderVersion = decision.versionNumber !== null && decision.versionNumber !== currentVersionNumber;
  return (
    <Alert
      data-testid="decision-banner"
      className={
        approved
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      }
    >
      {approved ? <CheckCircle2Icon /> : <XCircleIcon />}
      <AlertTitle>
        {approved ? "APPROVED" : "REJECTED"} for v{decision.versionNumber} by {decision.decidedBy}
      </AlertTitle>
      <AlertDescription className={approved ? "text-emerald-800 dark:text-emerald-200" : "text-red-800 dark:text-red-200"}>
        <p>{formatDateTime(decision.decidedAt)}</p>
        {decision.note && <p>Note: “{decision.note}”</p>}
        {olderVersion && (
          <p className="font-medium">
            v{currentVersionNumber} was created after this decision and has not been decided yet.
          </p>
        )}
        {!approved && !olderVersion && <p>Nothing was deleted: keep reviewing, regenerate the brief and decide again.</p>}
      </AlertDescription>
    </Alert>
  );
}
