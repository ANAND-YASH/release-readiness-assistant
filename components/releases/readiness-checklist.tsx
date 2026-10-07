import { CheckCircle2Icon, CircleDashedIcon, AlertTriangleIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChecklistItem, ChecklistState } from "@/lib/domain/readiness";

const ICON: Record<ChecklistState, React.ReactNode> = {
  done: <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Done" />,
  attention: <AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-400" aria-label="Needs attention" />,
  pending: <CircleDashedIcon className="size-4 text-muted-foreground" aria-label="Pending" />,
};

export function ReadinessChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness checklist</CardTitle>
        <CardDescription>Release approval is always a human decision.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.key} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0">{ICON[item.state]}</span>
              <div>
                <p className={item.state === "pending" ? "text-muted-foreground" : "font-medium"}>{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
