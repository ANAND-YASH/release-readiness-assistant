"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client/api-client";

export function LoadSampleButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPending(true);
    setError(null);
    const result = await postJson<{ id: string }>("/api/sample-release");
    if (result.ok) {
      router.push(`/releases/${result.data.id}?notice=sample`);
      router.refresh();
    } else {
      setError(result.error.message);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant={variant} onClick={load} disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
        {pending ? "Loading sample…" : "Load sample release"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
