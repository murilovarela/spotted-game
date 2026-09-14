import Link from "next/link";
import { redirect } from "next/navigation";
import { Hourglass } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ObjectRail } from "@/components/canvas/object-rail";
import { SubmitButton } from "@/components/shell/submit-button";
import { startAttemptAction } from "@/lib/games/actions";
import type { ObjectThumbnail } from "@/lib/types";
import { PlayerBar } from "./player-bar";

/**
 * Rendered before Start. By construction this tree never receives `image` — the prop type
 * has no such field — so the generated image cannot reach the HTML until the server has
 * written `started_at` (handoff "image before Start"). Task 7 asserts it on the wire.
 */
export function StartScreen({
  publicId,
  title,
  objects,
  signedIn,
  error,
}: {
  publicId: string;
  title: string;
  objects: readonly ObjectThumbnail[];
  signedIn: boolean;
  /** Already resolved to fixed copy by the page; never raw query text. */
  error: string | null;
}) {
  async function start() {
    "use server";
    const r = await startAttemptAction(publicId);
    // Carry the code, not the message: the page maps it to fixed copy (error-copy.ts).
    redirect(`/g/${publicId}${r.ok ? "" : `?error=${r.error}`}`);
  }
  return (
    <>
      <PlayerBar />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="font-display text-3xl font-bold">{title}</CardTitle>
            <CardDescription>Find {objects.length} hidden object{objects.length === 1 ? "" : "s"} as fast as you can.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">You are looking for</h2>
              <ObjectRail objects={objects} />
            </section>
            <Alert>
              <Hourglass aria-hidden />
              <AlertTitle>Before you start</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  <li>The timer starts the moment you press Start and does not pause — not if you close the tab, not if you walk away.</li>
                  <li>You get one submission. An unsubmitted attempt never reaches the leaderboard.</li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="justify-center">
            {signedIn ? (
              <form action={start}>
                <SubmitButton size="lg" className="h-14 px-10 text-lg" pendingLabel="Starting…">Start</SubmitButton>
              </form>
            ) : (
              <Button asChild size="lg" className="h-14 px-10 text-lg">
                <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/g/${publicId}`)}`}>Sign in to start</Link>
              </Button>
            )}
          </CardFooter>
        </Card>
      </main>
    </>
  );
}
