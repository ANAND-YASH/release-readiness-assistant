import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatementKind } from "@/lib/generated/prisma/enums";
import type { ReviewStatementDto } from "@/lib/services/analysis";
import { StatementCard, type CitableItem } from "./statement-card";

export type { CitableItem };

const GROUPS: { kind: StatementKind; title: string; description: string }[] = [
  { kind: "IMPACT", title: "Impact", description: "How much each change affects users, and who." },
  { kind: "MISSING_INFO", title: "Missing information", description: "Gaps a reviewer needs filled before sign-off." },
  {
    kind: "UNSUPPORTED_CLAIM",
    title: "Unsupported claims",
    description: "Claims in the package that the supplied QA evidence does not back up.",
  },
  { kind: "RISK", title: "Risks", description: "Risks and limitations for users and operators." },
  { kind: "TECH_SUMMARY", title: "Technical summary", description: "For engineers and operators." },
  { kind: "NONTECH_SUMMARY", title: "Non-technical summary", description: "For customers and stakeholders." },
];

export function StatementGroups({
  statements,
  items,
  currentVersionNumber,
}: {
  statements: ReviewStatementDto[];
  items: Record<string, CitableItem>;
  currentVersionNumber: number;
}) {
  return (
    <div className="space-y-6">
      {GROUPS.map((group) => {
        const groupStatements = statements.filter((s) => s.kind === group.kind);
        const pending = groupStatements.filter((s) => s.reviewStatus === "PENDING").length;
        const stale = groupStatements.filter((s) => s.stale.stale).length;
        return (
          <Card key={group.kind} id={group.kind.toLowerCase()} className="scroll-mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {group.title}
                <Badge variant="secondary" className="tabular-nums">
                  {groupStatements.length}
                </Badge>
                {pending > 0 && (
                  <span className="text-xs font-normal text-amber-700 dark:text-amber-400">{pending} pending</span>
                )}
                {stale > 0 && (
                  <span className="text-xs font-normal text-orange-700 dark:text-orange-400">{stale} stale</span>
                )}
              </CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {groupStatements.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing generated for this section.</p>
              ) : (
                <ul className="space-y-2">
                  {groupStatements.map((statement) => (
                    <StatementCard
                      key={statement.id}
                      statement={statement}
                      stale={statement.stale}
                      items={items}
                      currentVersionNumber={currentVersionNumber}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
