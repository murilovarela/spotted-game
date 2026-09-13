/**
 * Game status is derived on read (invariant 3). There is no status column and no
 * scheduler; this function is the only place the four states are defined.
 */
import type { GameStatus } from "./types";

export type StatusSource = {
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly publishedAt: Date | null;
};

/**
 * SPEC §3.2:
 *   draft      not published
 *   scheduled  published, now < starts_at
 *   active     starts_at ≤ now < ends_at
 *   finished   now ≥ ends_at
 *
 * `now` is always passed in so the function is pure and the boundaries are testable.
 * Comparisons are on epoch milliseconds, so time zones cannot enter (invariant 6).
 */
export function deriveStatus(game: StatusSource, now: Date): GameStatus {
  if (game.publishedAt === null) return "draft";
  if (game.startsAt === null || game.endsAt === null) {
    // The DB forbids this (games_published_has_window); reaching it is a data bug.
    throw new Error("Published game has no window");
  }
  const t = now.getTime();
  if (t < game.startsAt.getTime()) return "scheduled";
  if (t < game.endsAt.getTime()) return "active";
  return "finished";
}
