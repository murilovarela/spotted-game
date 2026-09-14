import type { LeaderboardEntry } from "@/lib/types";
import { formatElapsed } from "./format";

/** Names, scores, times — never coordinates (SPEC §3.4). Ranked by the server. */
export function Leaderboard({ entries }: { entries: readonly LeaderboardEntry[] }) {
  if (entries.length === 0) return <p className="text-neutral-500">No submissions yet.</p>;
  return (
    <table data-testid="leaderboard" className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="py-1 pr-3">#</th>
          <th className="py-1 pr-3">Player</th>
          <th className="py-1 pr-3">Found</th>
          <th className="py-1">Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.rank}-${e.userName}`} data-viewer={e.isViewer || undefined} className={e.isViewer ? "bg-yellow-50 font-medium" : undefined}>
            <td className="py-1 pr-3">{e.rank}</td>
            <td className="py-1 pr-3">{e.userName}</td>
            <td className="py-1 pr-3">{e.foundCount}</td>
            <td className="py-1 font-mono tabular-nums">{formatElapsed(e.elapsedMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
