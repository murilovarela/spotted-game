import { formatElapsed } from "@/components/canvas/format";
import { Leaderboard } from "@/components/canvas/leaderboard";
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p data-testid="result" className="text-lg">
        Found {result.foundCount} of {total} in <span className="font-mono">{formatElapsed(result.elapsedMs)}</span>
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} width={image.width} height={image.height} alt="" className="w-full rounded" />
      <section>
        <h2 className="mb-2 font-medium">Leaderboard</h2>
        <Leaderboard entries={leaderboard} />
      </section>
    </main>
  );
}
