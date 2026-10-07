"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  QA_RESULTS,
  type ChangeItem,
  type ChangeSection,
  type QaItem,
  type QaResult,
} from "@/lib/schema/release-package";
import { cn } from "@/lib/utils";
import { EmptyRow, ItemShell, SectionCard, selectClassName } from "./fields";
import { hasErrorAt, issuesAt, issuesUnder, type FormIssue } from "./form-issues";

interface ListHandlers<T> {
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<T>) => void;
  onRemove: (index: number) => void;
}

const SECTION_COPY: Record<ChangeSection, { title: string; description: string; addLabel: string; empty: string }> = {
  features: {
    title: "Completed features",
    description: "New capabilities shipped in this release.",
    addLabel: "Add feature",
    empty: "No features yet.",
  },
  bugFixes: {
    title: "Bug fixes",
    description: "Defects resolved in this release.",
    addLabel: "Add bug fix",
    empty: "No bug fixes yet.",
  },
  changedBehaviour: {
    title: "Changed behaviour",
    description: "Existing behaviour that users will notice is different. Mark breaking changes.",
    addLabel: "Add change",
    empty: "No behaviour changes yet.",
  },
};

export function ChangeItemsSection({
  section,
  items,
  issues,
  ...handlers
}: { section: ChangeSection; items: ChangeItem[]; issues: FormIssue[] } & ListHandlers<ChangeItem & { breaking: boolean }>) {
  const copy = SECTION_COPY[section];
  return (
    <SectionCard
      id={section}
      title={copy.title}
      description={copy.description}
      count={items.length}
      addLabel={copy.addLabel}
      onAdd={handlers.onAdd}
      issues={issuesAt(issues, section)}
    >
      {items.length === 0 && <EmptyRow>{copy.empty}</EmptyRow>}
      {items.map((item, index) => {
        const path = `${section}[${index}]`;
        return (
          <ItemShell
            key={item.id}
            id={item.id}
            onRemove={() => handlers.onRemove(index)}
            issues={issuesUnder(issues, path)}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${item.id}-title`}>Title</Label>
              <Input
                id={`${item.id}-title`}
                value={item.title}
                aria-invalid={hasErrorAt(issues, `${path}.title`)}
                onChange={(e) => handlers.onUpdate(index, { title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${item.id}-description`}>Description</Label>
              <Textarea
                id={`${item.id}-description`}
                value={item.description}
                rows={2}
                aria-invalid={hasErrorAt(issues, `${path}.description`)}
                onChange={(e) => handlers.onUpdate(index, { description: e.target.value })}
              />
            </div>
            {"breaking" in item && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${item.id}-breaking`}
                  checked={item.breaking}
                  onCheckedChange={(checked) => handlers.onUpdate(index, { breaking: checked === true })}
                />
                <Label htmlFor={`${item.id}-breaking`} className="font-normal">
                  Breaking change (users or integrations must act)
                </Label>
              </div>
            )}
          </ItemShell>
        );
      })}
    </SectionCard>
  );
}

const QA_RESULT_LABEL: Record<QaResult, string> = {
  pass: "Pass",
  fail: "Fail",
  partial: "Partial",
  not_run: "Not run",
};

export function QaEvidenceSection({
  items,
  changeItems,
  issues,
  ...handlers
}: { items: QaItem[]; changeItems: { id: string; title: string }[]; issues: FormIssue[] } & ListHandlers<QaItem>) {
  const knownIds = new Set(changeItems.map((item) => item.id));
  return (
    <SectionCard
      id="qaEvidence"
      title="QA evidence"
      description="Individual test results. Link each one to the changes it verifies."
      count={items.length}
      addLabel="Add evidence"
      onAdd={handlers.onAdd}
      issues={issuesAt(issues, "qaEvidence")}
    >
      {items.length === 0 && <EmptyRow>No QA evidence yet.</EmptyRow>}
      {items.map((qa, index) => {
        const path = `qaEvidence[${index}]`;
        const toggle = (id: string) =>
          handlers.onUpdate(index, {
            coversItemIds: qa.coversItemIds.includes(id)
              ? qa.coversItemIds.filter((x) => x !== id)
              : [...qa.coversItemIds, id],
          });
        const unknown = qa.coversItemIds.filter((id) => !knownIds.has(id));
        return (
          <ItemShell key={qa.id} id={qa.id} onRemove={() => handlers.onRemove(index)} issues={issuesUnder(issues, path)}>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-1.5">
                <Label htmlFor={`${qa.id}-title`}>Title</Label>
                <Input
                  id={`${qa.id}-title`}
                  value={qa.title}
                  aria-invalid={hasErrorAt(issues, `${path}.title`)}
                  onChange={(e) => handlers.onUpdate(index, { title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${qa.id}-result`}>Result</Label>
                <select
                  id={`${qa.id}-result`}
                  className={selectClassName}
                  value={qa.result}
                  onChange={(e) => handlers.onUpdate(index, { result: e.target.value as QaResult })}
                >
                  {QA_RESULTS.map((result) => (
                    <option key={result} value={result}>
                      {QA_RESULT_LABEL[result]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Covers</legend>
              {changeItems.length === 0 && unknown.length === 0 ? (
                <p className="text-xs text-muted-foreground">Add features, bug fixes or changes to link them here.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {changeItems.map((item) => {
                    const selected = qa.coversItemIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={selected}
                        title={item.title}
                        onClick={() => toggle(item.id)}
                        className={cn(
                          "rounded-md border px-2 py-0.5 font-mono text-xs transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {item.id}
                      </button>
                    );
                  })}
                  {unknown.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(id)}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-0.5 font-mono text-xs text-destructive"
                      title="Unknown item: click to remove"
                    >
                      {id} <XIcon className="size-3" />
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={`${qa.id}-notes`}>Notes</Label>
              <Textarea
                id={`${qa.id}-notes`}
                value={qa.notes}
                rows={2}
                placeholder="Environment, build, scope, gaps…"
                onChange={(e) => handlers.onUpdate(index, { notes: e.target.value })}
              />
            </div>
          </ItemShell>
        );
      })}
    </SectionCard>
  );
}

export function QaSummarySection({
  value,
  onChange,
  issues,
}: {
  value: string;
  onChange: (value: string) => void;
  issues: FormIssue[];
}) {
  return (
    <SectionCard
      id="qaSummary"
      title="QA summary"
      description="Overall QA outcome for this release, in your own words."
      issues={issuesAt(issues, "qaSummary")}
    >
      <Textarea
        aria-label="QA summary"
        value={value}
        rows={4}
        aria-invalid={hasErrorAt(issues, "qaSummary")}
        onChange={(e) => onChange(e.target.value)}
      />
    </SectionCard>
  );
}

export function NotesSection({
  section,
  title,
  description,
  noneLabel,
  items,
  noneDeclared,
  onToggleNone,
  issues,
  ...handlers
}: {
  section: "knownLimitations" | "migrationNotes";
  title: string;
  description: string;
  noneLabel: string;
  items: { id: string; text: string }[];
  noneDeclared: boolean;
  onToggleNone: (value: boolean) => void;
  issues: FormIssue[];
} & ListHandlers<{ text: string }>) {
  return (
    <SectionCard
      id={section}
      title={title}
      description={description}
      count={items.length}
      addLabel="Add entry"
      onAdd={handlers.onAdd}
      issues={issuesAt(issues, section)}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${section}-none`}
          checked={noneDeclared}
          onCheckedChange={(checked) => onToggleNone(checked === true)}
        />
        <Label htmlFor={`${section}-none`} className="font-normal">
          {noneLabel}
        </Label>
      </div>
      {items.map((entry, index) => {
        const path = `${section}[${index}]`;
        return (
          <ItemShell key={entry.id} id={entry.id} onRemove={() => handlers.onRemove(index)} issues={issuesUnder(issues, path)}>
            <Textarea
              aria-label={`${entry.id} text`}
              value={entry.text}
              rows={2}
              aria-invalid={hasErrorAt(issues, `${path}.text`)}
              onChange={(e) => handlers.onUpdate(index, { text: e.target.value })}
            />
          </ItemShell>
        );
      })}
    </SectionCard>
  );
}

export function UserGroupsSection({
  groups,
  onChange,
  issues,
}: {
  groups: string[];
  onChange: (groups: string[]) => void;
  issues: FormIssue[];
}) {
  return (
    <SectionCard
      id="affectedUserGroups"
      title="Affected user groups"
      description="Who will notice this release (e.g. billing admins, API integrators)."
      count={groups.length}
      issues={issuesUnder(issues, "affectedUserGroups")}
    >
      <div className="space-y-2">
        {groups.map((group, index) => (
          <div key={index} className="space-y-1">
            <div className="flex gap-2">
              <Input
                aria-label={`User group ${index + 1}`}
                value={group}
                aria-invalid={hasErrorAt(issues, `affectedUserGroups[${index}]`)}
                onChange={(e) => onChange(groups.map((g, i) => (i === index ? e.target.value : g)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove user group ${index + 1}`}
                onClick={() => onChange(groups.filter((_, i) => i !== index))}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...groups, ""])}>
          <PlusIcon /> Add group
        </Button>
      </div>
    </SectionCard>
  );
}
