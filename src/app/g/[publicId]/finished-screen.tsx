import { Leaderboard } from "@/components/canvas/leaderboard";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import type { FinishedGameView, LeaderboardEntry } from "@/lib/types";

/** After ends_at: true positions annotated, final board (SPEC §3.3.8). */
export function FinishedScreen({ view, leaderboard }: { view: FinishedGameView; leaderboard: readonly LeaderboardEntry[] }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{view.title}</h1>
      <p className="text-neutral-600">This game has ended. Here is where everything was.</p>
      <MarkerCanvas image={view.image} mode="reveal" markers={view.objects.map((o) => ({ id: o.id, x: o.x, y: o.y, radius: o.radius, label: o.label }))} />
      <section>
        <h2 className="mb-2 font-medium">Final leaderboard</h2>
        <Leaderboard entries={leaderboard} />
      </section>
    </main>
  );
}
