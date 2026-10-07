import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PackageEditor } from "@/components/package-editor/package-editor";
import { emptyCounters } from "@/lib/domain/item-ids";
import { ReleasePackageSchema } from "@/lib/schema/release-package";

export default function NewReleasePage() {
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/" className="hover:underline">Releases</Link>}
        title="New release"
        description="Describe what is shipping. Everything here is validated deterministically before it is saved."
      />
      <PackageEditor
        mode={{ kind: "create" }}
        initialPackage={ReleasePackageSchema.parse({ affectedUserGroups: [""] })}
        initialCounters={emptyCounters()}
      />
    </>
  );
}
