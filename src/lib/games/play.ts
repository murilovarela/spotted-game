/**
 * Play core. Scoring happens here and only here (invariant 1); timestamps are the
 * server's (invariant 5); a second submit is rejected by a conditional UPDATE.
 */
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { attempts, games, markers, objects, users, type Game, type User } from "@/db/schema";
import { scoreAttempt } from "@/lib/scoring";
import { deriveStatus } from "@/lib/status";
import type { AttemptResult, LeaderboardEntry, NormalizedPoint, PlayerAttemptState } from "@/lib/types";
import { fail, ok, type ActionResult } from "./result";
import { validateMarkerCount } from "./validation";

async function loadByPublicId(db: Database, publicId: string): Promise<ActionResult<Game>> {
  const [game] = await db.select().from(games).where(eq(games.publicId, publicId));
  return game ? ok(game) : fail("NOT_FOUND", "Game not found");
}

function requirePlayable(game: Game, user: User, now: Date): ActionResult<Game> {
  if (game.masterId === user.id) return fail("MASTER_CANNOT_PLAY", "The game master cannot play their own game");
  if (deriveStatus(game, now) !== "active") return fail("NOT_ACTIVE", "This game is not open for play");
  return ok(game);
}

export async function startAttempt(db: Database, user: User, publicId: string, now: Date): Promise<ActionResult<{ startedAt: Date }>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const playable = requirePlayable(loaded.data, user, now);
  if (!playable.ok) return playable;
  const game = playable.data;
  const inserted = await db
    .insert(attempts)
    .values({ gameId: game.id, userId: user.id, startedAt: now })
    .onConflictDoNothing({ target: [attempts.gameId, attempts.userId] })
    .returning({ startedAt: attempts.startedAt });
  if (inserted.length > 0) return ok(inserted[0]);
  const [existing] = await db
    .select({ startedAt: attempts.startedAt })
    .from(attempts)
    .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, user.id)));
  return ok(existing);
}

export async function submitAttempt(
  db: Database,
  user: User,
  publicId: string,
  points: readonly NormalizedPoint[],
  now: Date,
): Promise<ActionResult<AttemptResult>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const playable = requirePlayable(loaded.data, user, now);
  if (!playable.ok) return playable;
  const game = playable.data;
  if (game.imageWidth === null || game.imageHeight === null) return fail("NOT_ACTIVE", "Game image missing");
  const image = { width: game.imageWidth, height: game.imageHeight };

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, user.id)))
      .for("update");
    if (!attempt) return fail("NOT_STARTED", "Press Start before submitting");
    if (attempt.submittedAt !== null) return fail("ALREADY_SUBMITTED", "You have already submitted");

    const objs = await tx
      .select({ id: objects.id, x: objects.x, y: objects.y, radius: objects.radius })
      .from(objects)
      .where(eq(objects.gameId, game.id))
      .orderBy(asc(objects.sortOrder));
    const countCheck = validateMarkerCount(points.length, objs.length);
    if (!countCheck.ok) return countCheck;
    const scorable = objs.flatMap((o) => (o.x === null || o.y === null || o.radius === null ? [] : [{ id: o.id, x: o.x, y: o.y, radius: o.radius }]));
    const score = scoreAttempt({ markers: points, objects: scorable, image });

    // Handoff rule: the conditional UPDATE is the double-submit guard.
    const updated = await tx
      .update(attempts)
      .set({ submittedAt: now, foundCount: score.foundCount })
      .where(and(eq(attempts.id, attempt.id), isNull(attempts.submittedAt)))
      .returning({ elapsedMs: attempts.elapsedMs });
    if (updated.length === 0) return fail("ALREADY_SUBMITTED", "You have already submitted");

    await tx.insert(markers).values(
      points.map((p, i) => ({ attemptId: attempt.id, x: p.x, y: p.y, matchedObjectId: score.assignments[i] })),
    );
    const elapsedMs = updated[0].elapsedMs;
    if (elapsedMs === null) throw new Error("elapsed_ms not generated");
    return ok({ foundCount: score.foundCount, elapsedMs });
  });
}

export async function getPlayerState(db: Database, user: User, publicId: string, now: Date): Promise<ActionResult<PlayerAttemptState>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  void now;
  const [attempt] = await db
    .select({ startedAt: attempts.startedAt, submittedAt: attempts.submittedAt, foundCount: attempts.foundCount, elapsedMs: attempts.elapsedMs })
    .from(attempts)
    .where(and(eq(attempts.gameId, loaded.data.id), eq(attempts.userId, user.id)));
  if (!attempt) return ok({ kind: "not_started" });
  if (attempt.submittedAt === null || attempt.foundCount === null || attempt.elapsedMs === null) {
    return ok({ kind: "in_progress", startedAt: attempt.startedAt });
  }
  return ok({ kind: "submitted", result: { foundCount: attempt.foundCount, elapsedMs: attempt.elapsedMs } });
}

/** Hidden until the viewer has submitted (SPEC §3.4), except to the master and once finished. */
export async function getLeaderboard(db: Database, viewer: User | null, publicId: string, now: Date): Promise<ActionResult<LeaderboardEntry[]>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const game = loaded.data;
  const status = deriveStatus(game, now);
  const isMaster = viewer !== null && viewer.id === game.masterId;
  if (!isMaster && status !== "finished") {
    if (viewer === null) return fail("LEADERBOARD_HIDDEN", "Submit your attempt to see the leaderboard");
    const [own] = await db
      .select({ submittedAt: attempts.submittedAt })
      .from(attempts)
      .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, viewer.id)));
    if (!own || own.submittedAt === null) return fail("LEADERBOARD_HIDDEN", "Submit your attempt to see the leaderboard");
  }
  const rows = await db
    .select({ userId: attempts.userId, userName: users.name, email: users.email, foundCount: attempts.foundCount, elapsedMs: attempts.elapsedMs })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.userId))
    .where(and(eq(attempts.gameId, game.id), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.foundCount), asc(attempts.elapsedMs), asc(attempts.submittedAt));
  return ok(
    rows.map((r, i) => ({
      rank: i + 1,
      userName: r.userName ?? r.email.split("@")[0],
      foundCount: r.foundCount ?? 0,
      elapsedMs: r.elapsedMs ?? 0,
      isViewer: viewer !== null && r.userId === viewer.id,
    })),
  );
}
