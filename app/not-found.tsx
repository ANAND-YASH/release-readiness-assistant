import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card className="items-center gap-4 px-6 py-16 text-center">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">Not found</h2>
        <p className="text-sm text-muted-foreground">This release or version does not exist.</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to releases</Link>
      </Button>
    </Card>
  );
}
