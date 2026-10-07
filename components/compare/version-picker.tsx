"use client";

import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { selectClassName } from "@/components/package-editor/fields";

export function VersionPicker({
  releaseId,
  versions,
  from,
  to,
}: {
  releaseId: string;
  versions: number[];
  from: number;
  to: number;
}) {
  const router = useRouter();
  const go = (nextFrom: number, nextTo: number) =>
    router.push(`/releases/${releaseId}/compare?from=${nextFrom}&to=${nextTo}`);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="compare-from">From</Label>
        <select
          id="compare-from"
          className={`${selectClassName} w-28`}
          value={from}
          onChange={(e) => go(Number(e.target.value), to)}
        >
          {versions.map((v) => (
            // The other side's version can't be selected: comparing a version with itself is meaningless.
            <option key={v} value={v} disabled={v === to}>
              v{v}
            </option>
          ))}
        </select>
      </div>
      <ArrowRightIcon className="mb-2 size-4 text-muted-foreground" />
      <div className="space-y-1.5">
        <Label htmlFor="compare-to">To</Label>
        <select
          id="compare-to"
          className={`${selectClassName} w-28`}
          value={to}
          onChange={(e) => go(from, Number(e.target.value))}
        >
          {versions.map((v) => (
            <option key={v} value={v} disabled={v === from}>
              v{v}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
