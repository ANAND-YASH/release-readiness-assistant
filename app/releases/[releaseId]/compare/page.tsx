import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { VersionPicker } from "@/components/compare/version-picker";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ItemDiff } from "@/lib/domain/diff-versions";
import { formatDateTime } from "@/lib/format";
import { compareVersions, type ComparedVersion } from "@/lib/services/compare";
import { getRelease } from "@/lib/services/releases";
import { cn } from "@/lib/utils";

const SECTION_LABEL: Record<string, string> = {
  features: "Feature",
  bugFixes: "Bug fix",
  changedBehaviour: "Changed behaviour",
  qaEvidence: "QA evidence",
  knownLimitations: "Known limitation",
  migrationNotes: "Migration note",
};

const KIND_LABEL: Record<string, string> = {
  IMPACT: "Impact",
  MISSING_INFO: "Missing information",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  RISK: "Risk",
  TECH_SUMMARY: "Technical summary",
  NONTECH_SUMMARY: "Non-technical summary",
};

const CHANGE_STYLE = {
  added: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  removed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  modified: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  unchanged: "bg-muted text-muted-foreground",
} as const;

function parseVersion(value: string | string[] | undefined): number | null {
  return typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

function ItemRow({ item }: { item: ItemDiff }) {
  return (
    <li className="grid grid-cols-[3.5rem_1fr] items-baseline gap-2 text-sm">
      <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
      <span className="min-w-0">
        {item.label} <span className="text-xs whitespace-nowrap text-muted-foreground">{SECTION_LABEL[item.section]}</span>
      </span>
    </li>
  );
}

function BeforeAfter({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
      <div className="text-xs font-medium text-muted-foreground sm:pt-1">{label}</div>
      <div className="grid gap-1 sm:grid-cols-2">
        <div className="rounded-md border border-red-200 bg-red-50/60 px-2 py-1 dark:border-red-900 dark:bg-red-950/30">
          <span className="mr-1 text-xs font-semibold text-red-700 dark:text-red-300">Before</span>
          <span className="whitespace-pre-line">{before}</span>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-2 py-1 dark:border-emerald-900 dark:bg-emerald-950/30">
          <span className="mr-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">After</span>
          <span className="whitespace-pre-line">{after}</span>
        </div>
      </div>
    </div>
  );
}

function VersionMeta({ version }: { version: ComparedVersion }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-background p-3">
      <div className="font-medium">Version {version.versionNumber}</div>
      <div className="text-xs text-muted-foreground">{formatDateTime(version.createdAt)}</div>
      {version.changeNote && <p className="mt-1 text-sm">{version.changeNote}</p>}
    </div>
  );
}

function ListSection({ title, change, items, empty }: { title: string; change: ItemDiff["change"]; items: ItemDiff[]; empty: string }) {
  return (
    <Card id={change}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <Badge className={cn("rounded-md tabular-nums", CHANGE_STYLE[change])}>{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function ComparePage(props: PageProps<"/releases/[releaseId]/compare">) {
  await connection();
  const { releaseId } = await props.params;
  const searchParams = await props.searchParams;
  const release = await getRelease(releaseId);
  if (!release) notFound();

  const numbers = release.versions.map((v) => v.versionNumber).sort((a, b) => a - b);
  const latest = numbers[numbers.length - 1];
  const header = (
    <PageHeader
      eyebrow={
        <>
          <Link href="/" className="hover:underline">Releases</Link> /{" "}
          <Link href={`/releases/${release.id}`} className="hover:underline">{release.name}</Link>
        </>
      }
      title="Compare versions"
      description="Items are matched by their stable ID and compared by content hash. Statements generated for the older version are checked for staleness against the newer one."
    />
  );

  if (numbers.length < 2) {
    return (
      <>
        {header}
        <Card className="items-center gap-2 px-6 py-12 text-center">
          <h2 className="font-heading text-lg font-semibold">Only one version</h2>
          <p className="text-sm text-muted-foreground">Edit the package to create a second version, then compare them.</p>
        </Card>
      </>
    );
  }

  const from = parseVersion(searchParams.from) ?? numbers[numbers.length - 2];
  const to = parseVersion(searchParams.to) ?? latest;
  const picker = <VersionPicker releaseId={release.id} versions={numbers} from={from} to={to} />;

  if (from === to || !numbers.includes(from) || !numbers.includes(to)) {
    return (
      <>
        {header}
        <Card className="mb-6">
          <CardContent>{picker}</CardContent>
        </Card>
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>{from === to ? "Choose two different versions" : "Unknown version"}</AlertTitle>
          <AlertDescription>
            {from === to
              ? `Comparing v${from} with itself shows no differences. Pick a different "From" or "To" version.`
              : `This release has versions ${numbers.map((n) => `v${n}`).join(", ")}.`}
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const comparison = await compareVersions(release.id, from, to);
  const { counts } = comparison;
  const qaCoverageOnly = comparison.unchanged.filter((item) => item.qaCoverage);

  return (
    <>
      {header}
      <Card className="mb-6">
        <CardContent className="space-y-4">
          {picker}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <VersionMeta version={comparison.fromVersion} />
            <ArrowRightIcon className="mx-auto size-5 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" />
            <VersionMeta version={comparison.toVersion} />
          </div>
          {from > to && (
            <p className="text-xs text-muted-foreground">
              Comparing backwards: “added” means present in v{to} but not in v{from}.
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            {(["added", "removed", "modified", "unchanged"] as const).map((change) => (
              <a key={change} href={`#${change}`} className={cn("rounded-md px-2 py-0.5 capitalize", CHANGE_STYLE[change])}>
                {counts[change]} {change}
              </a>
            ))}
            <a href="#package" className="rounded-md bg-muted px-2 py-0.5">
              {comparison.scalarChanges.length} package-level change{comparison.scalarChanges.length === 1 ? "" : "s"}
            </a>
            <a href="#stale" className="rounded-md bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-950 dark:text-orange-200">
              {comparison.staleStatements.length} stale statement{comparison.staleStatements.length === 1 ? "" : "s"}
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <ListSection title="Added" change="added" items={comparison.added} empty={`Nothing new in v${to}.`} />
          <ListSection title="Removed" change="removed" items={comparison.removed} empty={`Nothing removed in v${to}.`} />
        </div>

        <Card id="modified">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Modified
              <Badge className={cn("rounded-md tabular-nums", CHANGE_STYLE.modified)}>{comparison.modified.length}</Badge>
            </CardTitle>
            <CardDescription>Same ID, different content. Field-level differences are shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {comparison.modified.length === 0 && <p className="text-sm text-muted-foreground">No items were modified.</p>}
            {comparison.modified.map((item) => (
              <div key={item.id} className="space-y-2 rounded-lg border p-3" data-testid={`modified-${item.id}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{SECTION_LABEL[item.section]}</span>
                </div>
                {item.fields.map((field) => (
                  <BeforeAfter key={field.field} label={field.label} before={field.before} after={field.after} />
                ))}
                {item.qaCoverage && (
                  <BeforeAfter
                    label="QA coverage"
                    before={item.qaCoverage.before.join(", ") || "(none)"}
                    after={item.qaCoverage.after.join(", ") || "(none)"}
                  />
                )}
              </div>
            ))}
            {qaCoverageOnly.length > 0 && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">QA coverage changed for unchanged items</p>
                {qaCoverageOnly.map((item) => (
                  <BeforeAfter
                    key={item.id}
                    label={`${item.id} ${item.label}`}
                    before={item.qaCoverage!.before.join(", ") || "(none)"}
                    after={item.qaCoverage!.after.join(", ") || "(none)"}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="package">
          <CardHeader>
            <CardTitle>Package-level changes</CardTitle>
            <CardDescription>QA summary, affected user groups and “none” declarations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.scalarChanges.length === 0 && (
              <p className="text-sm text-muted-foreground">No package-level changes.</p>
            )}
            {comparison.scalarChanges.map((change) => (
              <div key={change.field} className="space-y-1">
                <BeforeAfter label={change.label} before={change.before} after={change.after} />
                {(change.added?.length || change.removed?.length) ? (
                  <p className="text-xs text-muted-foreground sm:pl-32">
                    {change.added?.length ? `Added: ${change.added.join(", ")}. ` : ""}
                    {change.removed?.length ? `Removed: ${change.removed.join(", ")}.` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card id="stale">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Stale statements
              <Badge className="rounded-md bg-orange-100 tabular-nums text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                {comparison.staleStatements.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              Statements generated for v{from} whose cited evidence changed in v{to}. They must be regenerated before use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!comparison.fromAnalysis ? (
              <Alert>
                <InfoIcon />
                <AlertTitle>v{from} has no AI analysis</AlertTitle>
                <AlertDescription>
                  Nothing can be stale. <Link href={`/releases/${release.id}/review?v=${from}`}>Run analysis for v{from}</Link>{" "}
                  to see which statements a change would invalidate.
                </AlertDescription>
              </Alert>
            ) : comparison.staleStatements.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2Icon className="size-4" /> All {comparison.fromAnalysis.statementCount} statements from v{from} still
                match v{to}.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {comparison.staleStatements.length} of {comparison.fromAnalysis.statementCount} statements are stale;{" "}
                  {comparison.freshStatementCount} still match v{to}.
                </p>
                <ul className="space-y-2">
                  {comparison.staleStatements.map((statement) => (
                    <li key={statement.id} className="space-y-1 rounded-lg border p-3 text-sm" data-testid="stale-statement">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground">
                          Statement #{statement.order + 1} · {KIND_LABEL[statement.kind]}
                        </span>
                        <Badge className="rounded-md bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                          STALE
                        </Badge>
                        <span className="text-orange-800 dark:text-orange-300">{statement.stale.reasons.join("; ")}</span>
                      </div>
                      <p>{statement.content}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Unchanged
              <Badge className={cn("rounded-md tabular-nums", CHANGE_STYLE.unchanged)}>{comparison.unchanged.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">Show unchanged items</summary>
              <ul className="mt-2 space-y-1.5">
                {comparison.unchanged.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
