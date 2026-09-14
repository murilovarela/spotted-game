import { Trophy } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeaderboardEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatElapsed } from "./format";

/** Names, scores, times — never coordinates (SPEC §3.4). Ranked by the server. */
export function Leaderboard({ entries }: { entries: readonly LeaderboardEntry[] }) {
  if (entries.length === 0) return <p className="text-muted-foreground">No submissions yet — you could be first.</p>;
  return (
    <Table data-testid="leaderboard">
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">Found</TableHead>
          <TableHead className="text-right">Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Index key: entries have no id and tied rank+userName can collide; the list is server-ordered and never reordered client-side. */}
        {entries.map((e, i) => (
          <TableRow key={i} data-viewer={e.isViewer || undefined} className={cn(e.isViewer && "bg-primary/10 font-medium")}>
            <TableCell className="tabular-nums">{e.rank === 1 ? <Trophy className="size-4 text-primary" aria-label="1" /> : e.rank}</TableCell>
            <TableCell>{e.userName}{e.isViewer && <span className="ml-2 text-xs text-muted-foreground">you</span>}</TableCell>
            <TableCell className="text-right tabular-nums">{e.foundCount}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{formatElapsed(e.elapsedMs)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
