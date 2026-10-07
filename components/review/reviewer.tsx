"use client";

import { useSyncExternalStore } from "react";
import { UserIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Reviewer name, remembered per browser. There is no authentication yet, so the
// name is self-declared and recorded with every review action.

const STORAGE_KEY = "release-readiness.reviewer";
const EVENT = "reviewer-name-change";
let memoryFallback = "";

function read(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

function write(name: string) {
  memoryFallback = name;
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Storage unavailable (private mode, blocked): keep the in-memory value.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useReviewer(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, read, () => "");
  return [name, write];
}

export function ReviewerField() {
  const [name, setName] = useReviewer();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Label htmlFor="reviewer-name" className="flex shrink-0 items-center gap-1.5">
        <UserIcon className="size-4" /> Reviewer
      </Label>
      <Input
        id="reviewer-name"
        className="sm:max-w-64"
        placeholder="Your name (recorded with each review)"
        value={name}
        maxLength={100}
        aria-invalid={name.trim() === ""}
        onChange={(e) => setName(e.target.value)}
      />
      {name.trim() === "" && (
        <span className="text-xs text-amber-700 dark:text-amber-400">Required to approve, edit or reject.</span>
      )}
    </div>
  );
}
