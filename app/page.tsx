import Link from "next/link";
import { connection } from "next/server";
import { PackageIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { LoadSampleButton } from "@/components/releases/load-sample-button";
import { StatusBadge } from "@/components/releases/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { listReleases } from "@/lib/services/releases";

export default async function ReleasesPage() {
  await connection();
  const releases = await listReleases();

  return (
    <>
      <PageHeader
        title="Releases"
        description="Prepare release packages and track them through review to a human-approved brief."
        actions={
          releases.length > 0 && (
            <>
              <LoadSampleButton />
              <Button asChild>
                <Link href="/releases/new">
                  <PlusIcon /> New release
                </Link>
              </Button>
            </>
          )
        }
      />

      {releases.length === 0 ? (
        <Card className="items-center gap-4 px-6 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <PackageIcon className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="font-heading text-lg font-semibold">No releases yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Create a release from scratch, or load a sample release with two versions to explore the workflow.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Button asChild>
              <Link href="/releases/new">
                <PlusIcon /> Create release
              </Link>
            </Button>
            <LoadSampleButton />
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Release</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Latest version</th>
                  <th className="px-4 py-3 font-medium">Target date</th>
                  <th className="px-4 py-3 font-medium">Last updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {releases.map((release) => (
                  <tr key={release.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/releases/${release.id}`} className="font-medium hover:underline">
                        {release.name}
                      </Link>
                      <div className="text-muted-foreground">{release.product}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={release.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {release.latestVersion ? `v${release.latestVersion.versionNumber}` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(release.targetDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(release.latestVersion?.createdAt ?? release.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
