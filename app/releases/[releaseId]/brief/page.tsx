import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";
import { BriefExportButtons, GenerateBriefButton } from "@/components/brief/brief-actions";
import { BriefDocument } from "@/components/brief/brief-document";
import { DecisionPanel } from "@/components/brief/decision-panel";
import { PageHeader } from "@/components/page-header";
import { DecisionBanner } from "@/components/releases/decision-banner";
import { StatusBadge } from "@/components/releases/status-badge";
import { ReviewerField } from "@/components/review/reviewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BlockerCode } from "@/lib/domain/brief";
import { formatDate, formatDateTime } from "@/lib/format";
import { getReleaseReadiness } from "@/lib/services/readiness";

const KIND_LABEL: Record<string, string> = {
  IMPACT: "Impact",
  MISSING_INFO: "Missing information",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  RISK: "Risk",
  TECH_SUMMARY: "Technical summary",
  NONTECH_SUMMARY: "Non-technical summary",
};

const BLOCKER_LINK: Partial<Record<BlockerCode, { label: string; path: string }>> = {
  VALIDATION_ERRORS: { label: "Edit package", path: "edit" },
  NO_ANALYSIS: { label: "Run analysis", path: "review" },
  UNANALYSED_ITEMS: { label: "Re-run analysis", path: "review" },
  PENDING_STATEMENTS: { label: "Review statements", path: "review" },
  STALE_STATEMENTS: { label: "Resolve stale statements", path: "review" },
  NO_USABLE_STATEMENTS: { label: "Review statements", path: "review" },
};

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default async function BriefPage(props: PageProps<"/releases/[releaseId]/brief">) {
  await connection();
  const { releaseId } = await props.params;
  const readiness = await getReleaseReadiness(releaseId);
  if (!readiness) notFound();
  const { release, current, briefBlockers, latestBrief, briefUpToDate, approvalBlockers, reviewSummary, statements, assembled } =
    readiness;

  const included = latestBrief
    ? latestBrief.statementIds.map((id) => statements.find((s) => s.id === id)).filter((s) => s !== undefined)
    : [];
  const reviewById = new Map(readiness.review.statements.map((s) => [s.id, s]));
  const checks = [
    { label: "No blocking validation errors", ok: readiness.validation.valid },
    { label: "Successful AI analysis", ok: readiness.review.statementsRun !== null },
    { label: "No pending statements", ok: reviewSummary.pending === 0 && reviewSummary.total > 0, detail: `${reviewSummary.pending} pending` },
    {
      label: "No stale statements",
      ok: !briefBlockers.some((b) => b.code === "STALE_STATEMENTS") && reviewSummary.total > 0,
      detail: `${reviewSummary.stale} stale`,
    },
    {
      label: "At least one approved or edited statement",
      ok: reviewSummary.approved + reviewSummary.edited > 0,
      detail: `${reviewSummary.approved} approved · ${reviewSummary.edited} edited · ${reviewSummary.rejected} rejected`,
    },
    { label: "Final brief generated and up to date", ok: briefUpToDate },
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/" className="hover:underline">Releases</Link> /{" "}
            <Link href={`/releases/${release.id}`} className="hover:underline">{release.name}</Link>
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            Final brief · v{current.versionNumber} <StatusBadge status={release.status} />
          </span>
        }
        description={`${release.product} · Target ${formatDate(release.targetDate)} · Assembled from human-reviewed statements; the release decision is made by a person.`}
      />

      <div className="mb-6 space-y-4">
        <DecisionBanner release={release} currentVersionNumber={current.versionNumber} />
        <Card>
          <CardContent>
            <ReviewerField />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {briefBlockers.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-900" data-testid="brief-blocked">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangleIcon className="size-5 text-amber-600" /> The brief can&apos;t be generated yet
                </CardTitle>
                <CardDescription>Resolve these first. Only approved or edited, non-stale statements are ever included.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {briefBlockers.map((blocker) => {
                    const link = BLOCKER_LINK[blocker.code];
                    return (
                      <li key={blocker.code} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span>{blocker.message}</span>
                        {link && (
                          <Link className="text-primary hover:underline" href={`/releases/${release.id}/${link.path}`}>
                            {link.label} →
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {latestBrief ? (
            <Card>
              <CardHeader>
                <CardTitle>Final release brief</CardTitle>
                <CardDescription>
                  Generated {formatDateTime(latestBrief.createdAt)} by {latestBrief.generatedBy} ·{" "}
                  {latestBrief.statementIds.length} statements
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <BriefExportButtons
                    markdown={latestBrief.markdown}
                    filename={`${slug(release.name)}-v${current.versionNumber}-brief.md`}
                  />
                  {!briefUpToDate && assembled && (
                    <GenerateBriefButton releaseId={release.id} label="Regenerate brief" />
                  )}
                </div>
                {!briefUpToDate && (
                  <Alert className="border-amber-300 dark:border-amber-900">
                    <RefreshCwIcon />
                    <AlertTitle>This brief is out of date</AlertTitle>
                    <AlertDescription>
                      Statement reviews changed after it was generated.{" "}
                      {assembled ? "Regenerate it before deciding." : "Resolve the blockers above, then regenerate it."}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="rounded-lg border bg-background px-6 py-5 shadow-xs">
                  <BriefDocument markdown={latestBrief.markdown} />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="items-center gap-3 px-6 py-12 text-center" data-testid="brief-empty">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileTextIcon className="size-6 text-muted-foreground" />
              </div>
              <h2 className="font-heading text-lg font-semibold">No brief generated yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                The brief is assembled deterministically from the approved and edited statements of v{current.versionNumber}.
                No AI writes it.
              </p>
              <GenerateBriefButton releaseId={release.id} label="Generate final brief" disabled={briefBlockers.length > 0} />
            </Card>
          )}

          {latestBrief && (
            <Card>
              <CardHeader>
                <CardTitle>Included statements</CardTitle>
                <CardDescription>Exactly these human-reviewed statements make up the brief.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2" data-testid="included-statements">
                  {included.map((s) => {
                    const r = reviewById.get(s.id);
                    return (
                      <li key={s.id} className="space-y-1 rounded-lg border p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-medium text-muted-foreground">{KIND_LABEL[s.kind]}</span>
                          <Badge variant="outline" className="rounded-md">
                            {s.reviewStatus === "EDITED" ? "Edited" : "Approved"}
                            {r?.reviewedBy ? ` by ${r.reviewedBy}` : ""}
                          </Badge>
                          {r?.editedContent && <span className="text-muted-foreground">(uses edited text)</span>}
                        </div>
                        <p>{s.content}</p>
                        <p className="font-mono text-[0.7rem] text-muted-foreground">
                          {s.citations.map((c) => c.itemId).join(", ")}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Readiness · v{current.versionNumber}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-sm" data-testid="readiness">
                {checks.map((check) => (
                  <li key={check.label} className="flex gap-2">
                    {check.ok ? (
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    )}
                    <div>
                      <p className={check.ok ? "" : "font-medium"}>{check.label}</p>
                      {check.detail && <p className="text-xs text-muted-foreground">{check.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Release decision</CardTitle>
              <CardDescription>
                A human decision for v{current.versionNumber}. Approval records sign-off only; nothing is deployed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DecisionPanel releaseId={release.id} versionNumber={current.versionNumber} approvalBlockers={approvalBlockers} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
