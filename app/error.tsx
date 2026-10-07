"use client";

import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Card className="items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangleIcon className="size-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">Something went wrong</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          The page could not be loaded. This is usually temporary, for example if the database is unavailable.
        </p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <Button variant="outline" onClick={() => retry()}>
        <RotateCwIcon /> Try again
      </Button>
    </Card>
  );
}
