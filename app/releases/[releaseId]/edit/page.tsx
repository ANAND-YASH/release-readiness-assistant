import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { PackageEditor } from "@/components/package-editor/package-editor";
import { getItemCounters, getLatestVersion, getRelease } from "@/lib/services/releases";

export default async function EditPackagePage(props: PageProps<"/releases/[releaseId]/edit">) {
  await connection();
  const { releaseId } = await props.params;
  const [release, latest, counters] = await Promise.all([
    getRelease(releaseId),
    getLatestVersion(releaseId),
    getItemCounters(releaseId),
  ]);
  if (!release || !latest) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/" className="hover:underline">Releases</Link> /{" "}
            <Link href={`/releases/${release.id}`} className="hover:underline">{release.name}</Link>
          </>
        }
        title="Edit release package"
        description={`Editing a copy of version ${latest.versionNumber}. Saving creates version ${latest.versionNumber + 1}; existing versions are never modified.`}
      />
      <PackageEditor
        mode={{ kind: "edit", releaseId: release.id, baseVersionNumber: latest.versionNumber }}
        initialPackage={latest.package}
        initialCounters={counters}
      />
    </>
  );
}
