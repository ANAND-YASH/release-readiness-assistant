import { Badge } from "@/components/ui/badge";
import type { ReleaseStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STYLES: Record<ReleaseStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  IN_REVIEW: { label: "In review", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  APPROVED: { label: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  REJECTED: { label: "Rejected", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

export function StatusBadge({ status }: { status: ReleaseStatus }) {
  const style = STYLES[status];
  return <Badge className={cn("rounded-md", style.className)}>{style.label}</Badge>;
}
