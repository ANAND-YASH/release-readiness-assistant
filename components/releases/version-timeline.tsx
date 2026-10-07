import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, pluralize } from "@/lib/format";
import type { VersionSummary } from "@/lib/services/releases";

export function VersionTimeline({ releaseId, versions }: { releaseId: string; versions: VersionSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Version history</CardTitle>
        <CardDescription>Versions are immutable snapshots, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5 border-l pl-5">
          {versions.map((version, i) => (
            <li key={version.versionNumber} className="relative">
              <span
                className={`absolute -left-[1.6rem] top-1 size-2.5 rounded-full ring-4 ring-card ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">v{version.versionNumber}</span>
                {i === 0 && <Badge variant="secondary">Latest</Badge>}
                <span className="text-xs text-muted-foreground">{formatDateTime(version.createdAt)}</span>
              </div>
              {version.changeNote && <p className="mt-1 text-sm">{version.changeNote}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {pluralize(version.itemCount, "item")} · {pluralize(version.warningCount, "warning")} ·{" "}
                <span className="font-mono" title={version.packageHash}>
                  {version.packageHash.slice(0, 8)}
                </span>
              </p>
              <p className="mt-1 flex gap-3 text-xs">
                <Link className="text-primary hover:underline" href={`/releases/${releaseId}/review?v=${version.versionNumber}`}>
                  Review
                </Link>
                {version.versionNumber > 1 && (
                  <Link
                    className="text-primary hover:underline"
                    href={`/releases/${releaseId}/compare?from=${version.versionNumber - 1}&to=${version.versionNumber}`}
                  >
                    Compare with v{version.versionNumber - 1}
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
