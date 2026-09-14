import Link from "next/link";
import { PlayerBar } from "./player-bar";
import { formatElapsed } from "@/components/canvas/format";
import { Leaderboard } from "@/components/canvas/leaderboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttemptResult, GameImage, LeaderboardEntry } from "@/lib/types";

/** After submission. The image is shown bare: no markers, no hint of where the misses were (SPEC §3.3.7). */
export function ResultScreen({
  title,
  image,
  total,
  result,
  leaderboard,
}: {
  title: string;
  image: GameImage;
  total: number;
  result: AttemptResult;
  leaderboard: readonly LeaderboardEntry[];
}) {
  return (
    <>
      <PlayerBar />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <Card className="items-center text-center">
          <CardHeader className="items-center">
            <CardDescription>{title}</CardDescription>
            <CardTitle className="font-display text-4xl font-extrabold">
              {result.foundCount === total ? "All of them!" : result.foundCount === 0 ? "None this time" : "Nice spotting"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p data-testid="result" className="text-lg">
              Found {result.foundCount} of {total} in <span className="font-mono tabular-nums">{formatElapsed(result.elapsedMs)}</span>
            </p>
          </CardContent>
        </Card>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} width={image.width} height={image.height} alt="" className="w-full rounded-xl" />
        <section>
          <h2 className="mb-2 font-display text-xl font-bold">Leaderboard</h2>
          <Leaderboard entries={leaderboard} />
        </section>
        <Button asChild variant="outline" className="self-center">
          <Link href="/">Play another</Link>
        </Button>
      </main>
    </>
  );
}
