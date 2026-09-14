import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/shell/wordmark";

export default function GameNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <Wordmark />
      <h1 className="font-display text-3xl font-bold">This game isn&apos;t open</h1>
      <p className="max-w-sm text-muted-foreground">Either it does not exist or the master has not opened it to players yet. Check the link, or ask them.</p>
      <Button asChild variant="outline">
        <Link href="/">Home</Link>
      </Button>
    </main>
  );
}
