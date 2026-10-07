import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangleIcon, CheckCircle2Icon, FileTextIcon, GitCompareIcon, PencilIcon, SparklesIcon } from "lucide-react";
import { IssueList } from "@/components/package-editor/fields";
import { PageHeader } from "@/components/page-header";
import { DecisionBanner } from "@/components/releases/decision-banner";
import { PackageSummary } from "@/components/releases/package-summary";
import { ReadinessChecklist } from "@/components/releases/readiness-checklist";
import { StatusBadge } from "@/components/releases/status-badge";
import { VersionTimeline } from "@/components/releases/version-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readinessChecklist } from "@/lib/domain/readiness";
import { formatDate } from "@/lib/format";
import { getReleaseReadiness } from "@/lib/services/readiness";

const NOTICES: Record<string, (v?: string) => { title: string; body: string }> = {
  created: () => ({ title: "Release created", body: "Version 1 has been saved." }),
  saved: (v) => ({ title: `Version ${v} saved`, body: "Earlier versions are preserved unchanged." }),
  sample: () => ({
    title: "Sample release loaded",
    body: "It has two versions with added, removed and modified items to explore.",
  }),
};

export default async function ReleaseOverviewPage(props: PageProps<"/releases/[releaseId]">) {
  await connection();
  const { releaseId } = await props.params;
  const searchParams = await props.searchParams;
  const readiness = await getReleaseReadiness(releaseId);
  if (!readiness) notFound();
  const { release, current: latest, validation, review, reviewSummary } = readiness;
  const decisionForCurrent =
    release.decision?.versionNumber === latest.versionNumber && (release.status === "APPROVED" || release.status === "REJECTED")
      ? release.status
      : null;

  const noticeKey = typeof searchParams.notice === "string" ? searchParams.notice : undefined;
  const notice = noticeKey && NOTICES[noticeKey]?.(typeof searchParams.v === "string" ? searchParams.v : undefined);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/" className="hover:underline">Releases</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {release.name} <StatusBadge status={release.status} />
          </span>
        }
        description={`${release.product} · Target ${formatDate(release.targetDate)} · Latest version v${latest.versionNumber}`}
        actions={
          <>
            <Button asChild>
              <Link href={`/releases/${release.id}/edit`}>
                <PencilIcon /> Edit package
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/releases/${release.id}/review`}>
                <SparklesIcon /> Review
              </Link>
            </Button>
            {release.versions.length > 1 ? (
              <Button asChild variant="outline">
                <Link href={`/releases/${release.id}/compare?from=${latest.versionNumber - 1}&to=${latest.versionNumber}`}>
                  <GitCompareIcon /> Compare
                </Link>
              </Button>
            ) : (
              <Button variant="outline" disabled title="Needs at least two versions">
                <GitCompareIcon /> Compare
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/releases/${release.id}/brief`}>
                <FileTextIcon /> Brief
              </Link>
            </Button>
          </>
        }
      />

      {notice && (
        <Alert className="mb-6 border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          <CheckCircle2Icon />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription className="text-emerald-800 dark:text-emerald-200">{notice.body}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 empty:hidden">
        <DecisionBanner release={release} currentVersionNumber={latest.versionNumber} />
      </div>

      {reviewSummary.stale > 0 && (
        <Alert className="mb-6 border-orange-300 dark:border-orange-900">
          <AlertTriangleIcon className="text-orange-600" />
          <AlertTitle>
            {reviewSummary.stale} of {reviewSummary.total} statements are stale for v{latest.versionNumber}
          </AlertTitle>
          <AlertDescription>
            <p>
              They were generated for v{review.statementsRun?.versionNumber} and cite items that changed since.{" "}
              <Link href={`/releases/${release.id}/review`}>Review them</Link> or{" "}
              <Link
                href={`/releases/${release.id}/compare?from=${review.statementsRun?.versionNumber}&to=${latest.versionNumber}`}
              >
                see what changed
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Validation · v{latest.versionNumber}</CardTitle>
              <CardDescription>
                Deterministic checks on the current version. Blocking errors prevent saving; warnings are recorded
                for reviewers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {validation.errors.length === 0 && (
                <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-4" /> All required sections complete
                </p>
              )}
              <IssueList issues={validation.errors} />
              {validation.warnings.length === 0 ? (
                <p className="text-muted-foreground">No warnings.</p>
              ) : (
                <IssueList issues={validation.warnings} />
              )}
            </CardContent>
          </Card>
          <PackageSummary pkg={latest.package} versionNumber={latest.versionNumber} />
        </div>
        <div className="space-y-6">
          <ReadinessChecklist
            items={readinessChecklist(validation, review.latestRun?.status ?? "none", reviewSummary, review.carriedFrom, {
              brief: !readiness.latestBrief ? "none" : readiness.briefUpToDate ? "current" : "outdated",
              decision: decisionForCurrent,
            })}
          />
          <VersionTimeline releaseId={release.id} versions={release.versions} />
        </div>
      </div>
    </>
  );
}
