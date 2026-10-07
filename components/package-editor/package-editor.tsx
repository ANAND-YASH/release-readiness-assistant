"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postJson, type ClientApiError } from "@/lib/client/api-client";
import { nextItemId, type ItemCounters } from "@/lib/domain/item-ids";
import type { ValidationResult } from "@/lib/domain/validate-package";
import {
  CHANGE_SECTIONS,
  type ChangeSection,
  type ItemSection,
  type ReleasePackage,
} from "@/lib/schema/release-package";
import { ChangeNoteSchema, ReleaseMetadataSchema } from "@/lib/schema/release-requests";
import { IssueList } from "./fields";
import { checkPackage, hasErrorAt, issuesAt, zodIssues, type FormIssue } from "./form-issues";
import { ChangeItemsSection, NotesSection, QaEvidenceSection, QaSummarySection, UserGroupsSection } from "./sections";

export type EditorMode =
  | { kind: "create" }
  | { kind: "edit"; releaseId: string; baseVersionNumber: number };

interface Props {
  mode: EditorMode;
  initialPackage: ReleasePackage;
  initialCounters: ItemCounters;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; title: string; error: ClientApiError; issues: FormIssue[]; conflict?: boolean };

function blankItem(section: ItemSection, id: string) {
  switch (section) {
    case "features":
    case "bugFixes":
      return { id, title: "", description: "", userGroups: [] };
    case "changedBehaviour":
      return { id, title: "", description: "", userGroups: [], breaking: false };
    case "qaEvidence":
      return { id, title: "", result: "pass" as const, coversItemIds: [], notes: "" };
    case "knownLimitations":
    case "migrationNotes":
      return { id, text: "" };
  }
}

/** Turns a failed save response into a title and any issues it carries. */
function describeFailure(status: number, error: ClientApiError): Omit<Extract<SaveState, { kind: "failed" }>, "kind"> {
  if (error.code === "PACKAGE_INVALID" && error.details) {
    const validation = error.details as ValidationResult;
    return { title: "The server rejected the package", error, issues: validation.errors };
  }
  if (error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
    const issues = (error.details as { path: string; message: string }[]).map((d) => ({
      severity: "error" as const,
      path: d.path,
      message: d.message,
      code: "SCHEMA",
    }));
    return { title: "Some fields are invalid", error, issues };
  }
  if (status === 409) return { title: "A newer version exists", error, issues: [], conflict: true };
  if (error.code === "NO_CHANGES") return { title: "Nothing to save", error, issues: [] };
  return { title: "Save failed", error, issues: [] };
}

export function PackageEditor({ mode, initialPackage, initialCounters }: Props) {
  const router = useRouter();
  const [pkg, setPkg] = useState<ReleasePackage>(initialPackage);
  const [counters, setCounters] = useState(initialCounters);
  const [meta, setMeta] = useState({ name: "", product: "", targetDate: "" });
  const [changeNote, setChangeNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const packageIssues = useMemo(() => checkPackage(pkg), [pkg]);
  const formIssues = useMemo(() => {
    if (mode.kind === "create") {
      const parsed = ReleaseMetadataSchema.safeParse(meta);
      return parsed.success ? [] : zodIssues(parsed.error, "meta").map((i) => ({ ...i, code: "FORM" }));
    }
    const parsed = ChangeNoteSchema.safeParse(changeNote);
    return parsed.success ? [] : zodIssues(parsed.error, "changeNote").map((i) => ({ ...i, code: "FORM" }));
  }, [mode.kind, meta, changeNote]);

  const blocking = [...formIssues, ...packageIssues.filter((i) => i.severity === "error")];
  const warnings = packageIssues.filter((i) => i.severity === "warning");
  // Inline errors appear once the user has tried to save (or always when editing an
  // existing, previously valid package); warnings are always shown.
  const showErrors = attempted || mode.kind === "edit";
  const visible = showErrors ? [...formIssues, ...packageIssues] : warnings;

  const changeItems = CHANGE_SECTIONS.flatMap((section) => pkg[section]);

  // --- package mutations ----------------------------------------------------
  function addItem(section: ItemSection) {
    const { id, counters: next } = nextItemId(section, counters);
    setCounters(next);
    setPkg((p) => ({ ...p, [section]: [...p[section], blankItem(section, id)] }));
  }

  function updateItem<S extends ItemSection>(section: S, index: number, patch: Partial<ReleasePackage[S][number]>) {
    setPkg((p) => ({
      ...p,
      [section]: (p[section] as object[]).map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function removeItem(section: ItemSection, index: number) {
    setPkg((p) => {
      const removedId = p[section][index].id;
      const next = { ...p, [section]: p[section].filter((_, i) => i !== index) };
      // Keep QA links consistent when a change item is deleted.
      if ((CHANGE_SECTIONS as readonly string[]).includes(section)) {
        next.qaEvidence = next.qaEvidence.map((qa) => ({
          ...qa,
          coversItemIds: qa.coversItemIds.filter((id) => id !== removedId),
        }));
      }
      return next;
    });
  }

  const listHandlers = (section: ItemSection) => ({
    onAdd: () => addItem(section),
    onUpdate: (index: number, patch: object) => updateItem(section, index, patch),
    onRemove: (index: number) => removeItem(section, index),
  });

  // --- save -----------------------------------------------------------------
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (blocking.length > 0) {
      // The "resolve N issues" alert is derived from the live count, so it clears as issues are fixed.
      setSave({ kind: "idle" });
      return;
    }

    setSave({ kind: "saving" });
    if (mode.kind === "create") {
      const result = await postJson<{ release: { id: string } }>("/api/releases", { ...meta, package: pkg });
      if (result.ok) {
        router.push(`/releases/${result.data.release.id}?notice=created`);
        router.refresh();
        return;
      }
      setSave({ kind: "failed", ...describeFailure(result.status, result.error) });
    } else {
      const result = await postJson<{ versionNumber: number }>(`/api/releases/${mode.releaseId}/versions`, {
        package: pkg,
        changeNote,
        baseVersionNumber: mode.baseVersionNumber,
      });
      if (result.ok) {
        router.push(`/releases/${mode.releaseId}?notice=saved&v=${result.data.versionNumber}`);
        router.refresh();
        return;
      }
      setSave({ kind: "failed", ...describeFailure(result.status, result.error) });
    }
  }

  const saving = save.kind === "saving";
  const cancelHref = mode.kind === "create" ? "/" : `/releases/${mode.releaseId}`;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        {mode.kind === "create" && (
          <Card>
            <CardHeader>
              <CardTitle>Release details</CardTitle>
              <CardDescription>Basic metadata. The package below becomes version 1.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <MetaField
                id="meta.name"
                label="Release name"
                placeholder="Billing Portal 4.2"
                value={meta.name}
                issues={visible}
                onChange={(name) => setMeta((m) => ({ ...m, name }))}
              />
              <MetaField
                id="meta.product"
                label="Product"
                placeholder="Billing Portal"
                value={meta.product}
                issues={visible}
                onChange={(product) => setMeta((m) => ({ ...m, product }))}
              />
              <MetaField
                id="meta.targetDate"
                label="Target date (optional)"
                type="date"
                value={meta.targetDate}
                issues={visible}
                onChange={(targetDate) => setMeta((m) => ({ ...m, targetDate }))}
              />
            </CardContent>
          </Card>
        )}

        {(["features", "bugFixes", "changedBehaviour"] as ChangeSection[]).map((section) => (
          <ChangeItemsSection
            key={section}
            section={section}
            items={pkg[section]}
            issues={visible}
            {...listHandlers(section)}
          />
        ))}
        <QaSummarySection
          value={pkg.qaSummary}
          onChange={(qaSummary) => setPkg((p) => ({ ...p, qaSummary }))}
          issues={visible}
        />
        <QaEvidenceSection
          items={pkg.qaEvidence}
          changeItems={changeItems}
          issues={visible}
          {...listHandlers("qaEvidence")}
        />
        <NotesSection
          section="knownLimitations"
          title="Known limitations"
          description="Constraints or gaps users should know about."
          noneLabel="This release has no known limitations"
          items={pkg.knownLimitations}
          noneDeclared={pkg.noneDeclared.knownLimitations}
          onToggleNone={(value) =>
            setPkg((p) => ({ ...p, noneDeclared: { ...p.noneDeclared, knownLimitations: value } }))
          }
          issues={visible}
          {...listHandlers("knownLimitations")}
        />
        <NotesSection
          section="migrationNotes"
          title="Migration / configuration notes"
          description="Steps operators or customers must take, e.g. config changes or backfills."
          noneLabel="No migration or configuration steps are required"
          items={pkg.migrationNotes}
          noneDeclared={pkg.noneDeclared.migrationNotes}
          onToggleNone={(value) =>
            setPkg((p) => ({ ...p, noneDeclared: { ...p.noneDeclared, migrationNotes: value } }))
          }
          issues={visible}
          {...listHandlers("migrationNotes")}
        />
        <UserGroupsSection
          groups={pkg.affectedUserGroups}
          onChange={(affectedUserGroups) => setPkg((p) => ({ ...p, affectedUserGroups }))}
          issues={visible}
        />
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>{mode.kind === "create" ? "Create release" : `Save as version ${mode.baseVersionNumber + 1}`}</CardTitle>
            <CardDescription>
              {mode.kind === "create"
                ? "Validated before saving. Blocking errors must be fixed; warnings are recorded."
                : `Version ${mode.baseVersionNumber} stays unchanged. Your edits are saved as a new version.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode.kind === "edit" && (
              <div className="space-y-1.5">
                <Label htmlFor="changeNote">Change note</Label>
                <Textarea
                  id="changeNote"
                  rows={3}
                  value={changeNote}
                  placeholder="What changed and why?"
                  aria-invalid={attempted && hasErrorAt(formIssues, "changeNote")}
                  onChange={(e) => setChangeNote(e.target.value)}
                />
                {attempted && <IssueList issues={issuesAt(formIssues, "changeNote")} />}
              </div>
            )}

            <div className="space-y-2 text-sm">
              {blocking.length === 0 ? (
                <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-4" /> No blocking errors
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 font-medium text-destructive">
                    <AlertCircleIcon className="size-4" /> {blocking.length} blocking{" "}
                    {blocking.length === 1 ? "error" : "errors"}
                  </p>
                  <IssueList issues={blocking} className="max-h-48 space-y-1 overflow-y-auto" />
                </>
              )}
              {warnings.length > 0 && (
                <>
                  <p className="pt-2 font-medium text-amber-700 dark:text-amber-400">
                    {warnings.length} {warnings.length === 1 ? "warning" : "warnings"} (won&apos;t block saving)
                  </p>
                  <IssueList issues={warnings} className="max-h-48 space-y-1 overflow-y-auto" />
                </>
              )}
            </div>

            {attempted && blocking.length > 0 && save.kind !== "saving" && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>
                  Resolve {blocking.length} blocking {blocking.length === 1 ? "issue" : "issues"} before saving
                </AlertTitle>
                <AlertDescription>Fields with problems are highlighted.</AlertDescription>
              </Alert>
            )}

            {save.kind === "failed" && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>{save.title}</AlertTitle>
                <AlertDescription>
                  <p>{save.error.message}</p>
                  {save.issues.length > 0 && <IssueList issues={save.issues} />}
                  {save.conflict && (
                    <p>
                      <a href={`${cancelHref}/edit`}>Reload the latest version</a> (unsaved edits here will be lost).
                    </p>
                  )}
                  {save.error.requestId && <p className="font-mono text-xs">Request ID: {save.error.requestId}</p>}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving && <Loader2Icon className="animate-spin" />}
                {saving ? "Saving…" : mode.kind === "create" ? "Create release" : "Save new version"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={cancelHref}>Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}

function MetaField({
  id,
  label,
  value,
  onChange,
  issues,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  issues: FormIssue[];
  type?: string;
  placeholder?: string;
}) {
  const fieldIssues = issuesAt(issues, id);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-invalid={fieldIssues.length > 0}
        onChange={(e) => onChange(e.target.value)}
      />
      <IssueList issues={fieldIssues} />
    </div>
  );
}
