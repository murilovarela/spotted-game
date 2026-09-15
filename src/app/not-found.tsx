import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/shell/wordmark";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <Wordmark />
      <h1 className="font-display text-3xl font-bold">Nothing here</h1>
      <p className="max-w-sm text-muted-foreground">That page does not exist, or it is not open right now.</p>
      <Button asChild>
        <Link href="/">Back to the start</Link>
      </Button>
    </main>
  );
}
