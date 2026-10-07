// Client-side form checking. Runs the same Zod schema and validatePackage() as the
// server, so the feedback shown while editing matches what the API will enforce.

import type { z } from "zod";
import { validatePackage } from "@/lib/domain/validate-package";
import { ReleasePackageSchema, type ReleasePackage } from "@/lib/schema/release-package";

export interface FormIssue {
  severity: "error" | "warning";
  /** Dotted path, e.g. "features[0].title", "meta.name", "changeNote". */
  path: string;
  message: string;
  code?: string;
  itemId?: string;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment, i) => (typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`))
    .join("");
}

export function zodIssues(error: z.ZodError, prefix?: string): FormIssue[] {
  return error.issues.map((issue) => ({
    severity: "error",
    path: formatPath(prefix ? [prefix, ...issue.path] : issue.path),
    message: issue.message,
    code: "SCHEMA",
  }));
}

/** Schema errors if the package is malformed; otherwise business-rule errors and warnings. */
export function checkPackage(pkg: ReleasePackage): FormIssue[] {
  const parsed = ReleasePackageSchema.safeParse(pkg);
  if (!parsed.success) return zodIssues(parsed.error);
  const result = validatePackage(parsed.data);
  return [...result.errors, ...result.warnings];
}

/** Issues at `path` or nested below it. */
export function issuesUnder(issues: FormIssue[], path: string): FormIssue[] {
  return issues.filter(
    (issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`),
  );
}

export function issuesAt(issues: FormIssue[], path: string): FormIssue[] {
  return issues.filter((issue) => issue.path === path);
}

export function hasErrorAt(issues: FormIssue[], path: string): boolean {
  return issues.some((issue) => issue.path === path && issue.severity === "error");
}
