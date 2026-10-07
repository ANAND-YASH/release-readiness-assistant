import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReleasePackage } from "@/lib/schema/release-package";

const QA_RESULT_STYLE = {
  pass: "text-emerald-700 dark:text-emerald-400",
  fail: "text-destructive",
  partial: "text-amber-700 dark:text-amber-400",
  not_run: "text-muted-foreground",
} as const;

function Section({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {title}
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      </h3>
      {count === 0 ? <p className="text-sm text-muted-foreground">None</p> : children}
    </section>
  );
}

function ItemRow({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm">
      <span className="w-14 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{id}</span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

export function PackageSummary({ pkg, versionNumber }: { pkg: ReleasePackage; versionNumber: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Release package · v{versionNumber}</CardTitle>
        <CardDescription>Contents of the latest version.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {(
          [
            ["Completed features", pkg.features],
            ["Bug fixes", pkg.bugFixes],
            ["Changed behaviour", pkg.changedBehaviour],
          ] as const
        ).map(([title, items]) => (
          <Section key={title} title={title} count={items.length}>
            <ul className="space-y-1.5">
              {items.map((item) => (
                <ItemRow key={item.id} id={item.id}>
                  {item.title}
                  {"breaking" in item && item.breaking && (
                    <Badge variant="destructive" className="ml-2 rounded-md">
                      Breaking
                    </Badge>
                  )}
                </ItemRow>
              ))}
            </ul>
          </Section>
        ))}

        <Section title="QA evidence" count={pkg.qaEvidence.length}>
          <ul className="space-y-1.5">
            {pkg.qaEvidence.map((qa) => (
              <ItemRow key={qa.id} id={qa.id}>
                {qa.title}{" "}
                <span className={`text-xs font-medium ${QA_RESULT_STYLE[qa.result]}`}>
                  {qa.result.replace("_", " ")}
                </span>
                {qa.coversItemIds.length > 0 && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">→ {qa.coversItemIds.join(", ")}</span>
                )}
              </ItemRow>
            ))}
          </ul>
        </Section>

        <section className="space-y-1">
          <h3 className="text-sm font-medium">QA summary</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-line">{pkg.qaSummary}</p>
        </section>

        {(
          [
            ["Known limitations", pkg.knownLimitations, pkg.noneDeclared.knownLimitations],
            ["Migration / configuration notes", pkg.migrationNotes, pkg.noneDeclared.migrationNotes],
          ] as const
        ).map(([title, items, none]) => (
          <Section key={title} title={title} count={items.length}>
            {none ? null : (
              <ul className="space-y-1.5">
                {items.map((entry) => (
                  <ItemRow key={entry.id} id={entry.id}>
                    {entry.text}
                  </ItemRow>
                ))}
              </ul>
            )}
          </Section>
        ))}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Affected user groups</h3>
          <div className="flex flex-wrap gap-1.5">
            {pkg.affectedUserGroups.map((group) => (
              <Badge key={group} variant="outline" className="rounded-md">
                {group}
              </Badge>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
