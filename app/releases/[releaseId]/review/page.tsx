import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CheckCircle2Icon, HistoryIcon, InboxIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { IssueList } from "@/components/package-editor/fields";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/releases/status-badge";
import { ReviewSummaryPanel } from "@/components/review/review-summary";
import { ReviewerField } from "@/components/review/reviewer";
import { RunAnalysisPanel } from "@/components/review/run-analysis-panel";
import { StatementGroups, type CitableItem } from "@/components/review/statement-groups";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizeReview } from "@/lib/domain/review";
import { validatePackage } from "@/lib/domain/validate-package";
import { formatDateTime, pluralize } from "@/lib/format";
import { listItems, type ReleasePackage } from "@/lib/schema/release-package";
import { getReviewData } from "@/lib/services/analysis";
import { getRelease, getVersion } from "@/lib/services/releases";
import { cn } from "@/lib/utils";

const SECTION_LABEL: Record<string, string> = {
  features: "Feature",
  bugFixes: "Bug fix",
  changedBehaviour: "Changed behaviour",
  qaEvidence: "QA evidence",
  knownLimitations: "Known limitation",
  migrationNotes: "Migration note",
};

function citableItems(pkg: ReleasePackage): Record<string, CitableItem> {
  return Object.fromEntries(
    listItems(pkg).map(({ section, item }) => [
      item.id,
      { section: SECTION_LABEL[section], label: "title" in item ? item.title : item.text },
    ]),
  );
}

export default async function ReviewPage(props: PageProps<"/releases/[releaseId]/review">) {
  await connection();
  const { releaseId } = await props.params;
  const searchParams = await props.searchParams;
  const release = await getRelease(releaseId);
  if (!release || release.versions.length === 0) notFound();

  const requested = typeof searchParams.v === "string" ? Number(searchParams.v) : release.versions[0].versionNumber;
  const version = Number.isInteger(requested) ? await getVersion(releaseId, requested) : null;
  if (!version) notFound();

  const review = await getReviewData(releaseId, version.versionNumber);
  if (!review) notFound();
  const source = review.carriedFrom ? await getVersion(releaseId, review.carriedFrom) : null;

  // Re-validate on read so the page reflects the current rules, which the analysis pre-check also uses.
  const validation = validatePackage(version.package);
  // Carried-over statements may cite items that no longer exist; label them from the source version.
  const items = { ...(source ? citableItems(source.package) : {}), ...citableItems(version.package) };
  const run = review.statementsRun;
  const latestFailed = review.latestRun?.status === "FAILED" ? review.latestRun : null;
  const running = review.latestRun?.status === "RUNNING" ? review.latestRun : null;
  const summary = summarizeReview(review.statements.map((s) => ({ reviewStatus: s.reviewStatus, stale: s.stale.stale })));
  const isCurrent = version.versionNumber === review.currentVersionNumber;

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
            Review · v{version.versionNumber} <StatusBadge status={release.status} />
          </span>
        }
        description={`${release.product} · AI-generated statements are drafts until a human reviews them. AI never approves or deploys a release.`}
      />

      <ReviewSummaryPanel summary={summary} latestRun={review.latestRun} />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Version:</span>
        {release.versions.map((v) => (
          <Link
            key={v.versionNumber}
            href={`/releases/${release.id}/review?v=${v.versionNumber}`}
            className={cn(
              "rounded-md border px-2 py-0.5 tabular-nums",
              v.versionNumber === version.versionNumber ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            v{v.versionNumber}
          </Link>
        ))}
        {!isCurrent && (
          <span className="text-xs text-muted-foreground">
            Viewing an older version; staleness is checked against the current version v{review.currentVersionNumber}.
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI analysis</CardTitle>
              <CardDescription>
                Deterministic checks run first; the model then classifies impact, flags missing information and
                unsupported claims, lists risks and drafts summaries. Every statement must cite items from this version.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {running && (
                <Alert>
                  <Loader2Icon className="animate-spin" />
                  <AlertTitle>Analysis in progress</AlertTitle>
                  <AlertDescription>
                    A run started at {formatDateTime(running.createdAt)} is still running. Refresh the page to see its
                    results.
                  </AlertDescription>
                </Alert>
              )}
              {review.carriedFrom !== null && (
                <Alert>
                  <HistoryIcon />
                  <AlertTitle>
                    Showing statements from the v{review.carriedFrom} analysis
                  </AlertTitle>
                  <AlertDescription>
                    v{version.versionNumber} has not been analysed yet. Statements that still match v
                    {version.versionNumber} can be reviewed; stale ones must be regenerated by running analysis for v
                    {version.versionNumber}.
                  </AlertDescription>
                </Alert>
              )}
              <RunAnalysisPanel
                releaseId={release.id}
                versionNumber={version.versionNumber}
                blocked={!validation.valid}
                hasAnalysis={run !== null && review.carriedFrom === null}
                reviewedCount={review.carriedFrom === null ? summary.reviewed : 0}
                lastRunError={latestFailed?.error ?? null}
              />
            </CardContent>
          </Card>

          {run && review.statements.length > 0 ? (
            <>
              <Card>
                <CardContent>
                  <ReviewerField />
                </CardContent>
              </Card>
              <StatementGroups
                statements={review.statements}
                items={items}
                currentVersionNumber={review.currentVersionNumber}
              />
            </>
          ) : run ? (
            <Card className="items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <InboxIcon className="size-6 text-muted-foreground" />
              </div>
              <h2 className="font-heading text-lg font-semibold">No statements to review</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                The latest analysis completed but produced no statements that passed citation checks. Re-run the
                analysis or check the package content.
              </p>
            </Card>
          ) : (
            <Card className="items-center gap-3 px-6 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <SparklesIcon className="size-6 text-muted-foreground" />
              </div>
              <h2 className="font-heading text-lg font-semibold">No analysis yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Run AI analysis to generate impact classifications, missing information, unsupported claims, risks and
                technical and non-technical summaries for v{version.versionNumber}.
              </p>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Validation · v{version.versionNumber}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {validation.valid ? (
                <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-4" /> No blocking errors
                </p>
              ) : (
                <IssueList issues={validation.errors} />
              )}
              <p className="text-muted-foreground">{pluralize(validation.warnings.length, "warning")}</p>
              <IssueList issues={validation.warnings} />
            </CardContent>
          </Card>

          {run && (
            <Card>
              <CardHeader>
                <CardTitle>Analysis run</CardTitle>
                <CardDescription>
                  {formatDateTime(run.createdAt)} · for v{run.versionNumber}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Statements</dt>
                  <dd>
                    {review.statements.length}{" "}
                    <Badge variant="outline" className="ml-1 rounded-md">
                      {summary.pending} pending
                    </Badge>
                  </dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd>
                    {run.provider} · <span className="font-mono text-xs">{run.model}</span>
                  </dd>
                  <dt className="text-muted-foreground">Prompts</dt>
                  <dd className="font-mono text-xs leading-5">{run.promptVersion}</dd>
                  <dt className="text-muted-foreground">Attempts</dt>
                  <dd>{run.attempts}</dd>
                  <dt className="text-muted-foreground">Latency</dt>
                  <dd>{run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1)}s` : "—"}</dd>
                  {run.promptTokens !== null && (
                    <>
                      <dt className="text-muted-foreground">Tokens</dt>
                      <dd>
                        {run.promptTokens} in · {run.completionTokens} out
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Input hash</dt>
                  <dd className="font-mono text-xs" title={run.inputHash}>
                    {run.inputHash.slice(0, 12)}
                  </dd>
                </dl>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
