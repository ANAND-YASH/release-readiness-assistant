import type { ReactNode } from "react";
import { AlertCircleIcon, AlertTriangleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormIssue } from "./form-issues";

export function IssueList({ issues, className }: { issues: FormIssue[]; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className={className ?? "space-y-1"}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.path}-${issue.code}-${i}`}
          className={`flex gap-1.5 text-xs ${issue.severity === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}
        >
          {issue.severity === "error" ? (
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
          ) : (
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
          )}
          <span>
            {issue.code === "SCHEMA" && <span className="font-mono">{issue.path}: </span>}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SectionCard({
  id,
  title,
  description,
  count,
  addLabel,
  onAdd,
  addDisabled,
  issues,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count?: number;
  addLabel?: string;
  onAdd?: () => void;
  addDisabled?: boolean;
  issues: FormIssue[];
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {count !== undefined && (
            <Badge variant="secondary" className="tabular-nums">
              {count}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {onAdd && (
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={addDisabled}>
              <PlusIcon /> {addLabel}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <IssueList issues={issues} />
        {children}
      </CardContent>
    </Card>
  );
}

export function ItemShell({
  id,
  onRemove,
  issues,
  children,
}: {
  id: string;
  onRemove: () => void;
  issues: FormIssue[];
  children: ReactNode;
}) {
  const hasError = issues.some((issue) => issue.severity === "error");
  return (
    <div className={`space-y-3 rounded-lg border p-3 ${hasError ? "border-destructive/50" : ""}`}>
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="rounded-md font-mono">
          {id}
        </Badge>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${id}`}>
          <Trash2Icon />
        </Button>
      </div>
      {children}
      <IssueList issues={issues} />
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

export const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
