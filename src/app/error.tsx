"use client";
import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-display text-3xl font-bold">Something went wrong</h1>
      <p className="max-w-sm text-muted-foreground">The page hit an error. Trying again usually fixes it.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
