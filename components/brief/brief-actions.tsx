"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircleIcon, CheckIcon, CopyIcon, DownloadIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { useReviewer } from "@/components/review/reviewer";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client/api-client";

export function GenerateBriefButton({
  releaseId,
  label,
  disabled,
}: {
  releaseId: string;
  label: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [reviewer] = useReviewer();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function generate() {
    if (!reviewer.trim()) {
      setError("Enter your reviewer name first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await postJson(`/api/releases/${releaseId}/brief`, { reviewer: reviewer.trim() });
      if (!result.ok) {
        const blockers = (result.error.details as { blockers?: { message: string }[] } | undefined)?.blockers;
        setError(blockers?.length ? blockers.map((b) => b.message).join(" ") : result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={generate} disabled={disabled || isPending}>
        {isPending ? <Loader2Icon className="animate-spin" /> : <FileTextIcon />} {label}
      </Button>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

export function BriefExportButtons({ markdown, filename }: { markdown: string; filename: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={copy}>
        {copied === "copied" ? <CheckIcon /> : <CopyIcon />} {copied === "copied" ? "Copied" : "Copy brief"}
      </Button>
      <Button variant="outline" size="sm" onClick={download}>
        <DownloadIcon /> Download Markdown
      </Button>
      {copied === "failed" && <span className="text-xs text-destructive">Clipboard unavailable; use Download.</span>}
    </div>
  );
}
