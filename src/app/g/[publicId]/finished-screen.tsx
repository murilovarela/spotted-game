import { PlayerBar } from "./player-bar";
import { Leaderboard } from "@/components/canvas/leaderboard";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import type { FinishedGameView, LeaderboardEntry } from "@/lib/types";

/** After ends_at: true positions annotated, final board (SPEC §3.3.8). */
export function FinishedScreen({ view, leaderboard }: { view: FinishedGameView; leaderboard: readonly LeaderboardEntry[] }) {
  return (
    <>
      <PlayerBar />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="font-display text-3xl font-bold">{view.title}</h1>
        <p className="text-muted-foreground">This game has ended. Here is where everything was.</p>
        <div className="overflow-hidden rounded-xl">
          <MarkerCanvas
            image={view.image}
            mode="reveal"
            markers={view.objects.map((o) => ({ id: o.id, x: o.x, y: o.y, radius: o.radius, label: o.label }))}
          />
        </div>
        <section>
          <h2 className="mb-2 font-display text-xl font-bold">Final leaderboard</h2>
          <Leaderboard entries={leaderboard} />
        </section>
      </main>
    </>
  );
}
