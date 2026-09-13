/**
 * Authoring core. Every function takes the database and the acting user explicitly so
 * integration tests run the real logic; `actions.ts` wraps these for the UI.
 */
import { and, asc, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Database } from "@/db";
import { games, objects, type Game, type User } from "@/db/schema";
import { deriveStatus } from "@/lib/status";
import { MAX_OBJECTS_PER_GAME, PUBLIC_ID_LENGTH, type Normalized } from "@/lib/types";
import { isOwnedKey } from "@/lib/storage";
import { fail, ok, type ActionResult } from "./result";
import { isUuid, publishPreconditions, validateLabel, validatePrompt, validateTitle, validateWindow } from "./validation";

// Drizzle's transaction handle has the same query surface as the root db. If the
// inferred `Tx` type ever stops lining up with a builder method used below, fall back to
// `Pick<Database, "select" | "insert" | "update" | "delete">` — never `any`.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

/**
 * Controller ruling (Task 4 carry-forward): a caller-supplied id that isn't a UUID must
 * fail as NOT_FOUND here, before it reaches a `uuid` column — otherwise Postgres throws
 * across the action boundary. Both `loadOwnedGame` and `loadOwnedObject` check first.
 */
async function loadOwnedGame(db: Db, user: User, gameId: string, forUpdate = false): Promise<ActionResult<Game>> {
  if (!isUuid(gameId)) return fail("NOT_FOUND", "Game not found");
  const q = db.select().from(games).where(eq(games.id, gameId));
  const [game] = forUpdate ? await q.for("update") : await q;
  if (!game) return fail("NOT_FOUND", "Game not found");
  if (game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can do that");
  return ok(game);
}

const requireDraft = (game: Game): ActionResult<Game> =>
  game.publishedAt === null ? ok(game) : fail("NOT_DRAFT", "Unpublish the game to edit it");

/**
 * `loadOwnedGame` + `requireDraft`, locked. The common precondition for every
 * draft-only game mutation (updateGame, deleteGame, addObject, setWindow).
 */
async function loadOwnedDraft(tx: Db, user: User, gameId: string): Promise<ActionResult<Game>> {
  const owned = await loadOwnedGame(tx, user, gameId, true);
  if (!owned.ok) return owned;
  return requireDraft(owned.data);
}

export async function createGame(
  db: Database,
  user: User,
  input: { title: string; generalPrompt: string },
): Promise<ActionResult<{ id: string; publicId: string }>> {
  const title = validateTitle(input.title);
  if (!title.ok) return title;
  const prompt = validatePrompt(input.generalPrompt);
  if (!prompt.ok) return prompt;
  const publicId = nanoid(PUBLIC_ID_LENGTH);
  const [row] = await db
    .insert(games)
    .values({ publicId, masterId: user.id, title: title.data, generalPrompt: prompt.data })
    .returning({ id: games.id, publicId: games.publicId });
  return ok(row);
}

export async function updateGame(
  db: Database,
  user: User,
  gameId: string,
  input: { title?: string; generalPrompt?: string; backgroundKey?: string },
): Promise<ActionResult<null>> {
  // Locked so a concurrent publishGame can't commit between this read and this write
  // (invariant 4's window — see games.integration.test.ts's lock-ordering test).
  return db.transaction(async (tx) => {
    const draft = await loadOwnedDraft(tx, user, gameId);
    if (!draft.ok) return draft;
    const set: Partial<typeof games.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) {
      const t = validateTitle(input.title);
      if (!t.ok) return t;
      set.title = t.data;
    }
    if (input.generalPrompt !== undefined) {
      const p = validatePrompt(input.generalPrompt);
      if (!p.ok) return p;
      set.generalPrompt = p.data;
    }
    if (input.backgroundKey !== undefined) {
      if (!isOwnedKey("background", gameId, input.backgroundKey)) {
        return fail("INVALID_INPUT", "Image key does not belong to this game");
      }
      set.backgroundKey = input.backgroundKey;
    }
    await tx.update(games).set(set).where(eq(games.id, gameId));
    return ok(null);
  });
}

export async function deleteGame(db: Database, user: User, gameId: string): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const draft = await loadOwnedDraft(tx, user, gameId);
    if (!draft.ok) return draft;
    await tx.delete(games).where(eq(games.id, gameId)); // objects cascade
    return ok(null);
  });
}

export async function addObject(
  db: Database,
  user: User,
  gameId: string,
  input: { label: string; prompt: string; sourceImageKey: string; requestedScale?: Normalized },
): Promise<ActionResult<{ id: string }>> {
  return db.transaction(async (tx) => {
    const draft = await loadOwnedDraft(tx, user, gameId);
    if (!draft.ok) return draft;
    const label = validateLabel(input.label);
    if (!label.ok) return label;
    const prompt = validatePrompt(input.prompt);
    if (!prompt.ok) return prompt;
    if (!isOwnedKey("object", gameId, input.sourceImageKey)) {
      return fail("INVALID_INPUT", "Image key does not belong to this game");
    }
    const [{ n }] = await tx.select({ n: count() }).from(objects).where(eq(objects.gameId, gameId));
    if (n >= MAX_OBJECTS_PER_GAME) return fail("TOO_MANY_OBJECTS", `At most ${MAX_OBJECTS_PER_GAME} objects`);
    const [row] = await tx
      .insert(objects)
      .values({
        gameId,
        label: label.data,
        prompt: prompt.data,
        sourceImageKey: input.sourceImageKey,
        requestedScale: input.requestedScale ?? null,
        sortOrder: n,
      })
      .returning({ id: objects.id });
    return ok(row);
  });
}

/**
 * Locked (invariant 4): find which game the object belongs to, lock that game row first —
 * the same row `publishGame` locks — then re-read the object fresh so sortOrder, x/y/radius
 * and confirmed reflect anything committed while this call waited on the lock. All callers
 * mutate, so every call locks.
 */
async function loadOwnedObject(
  db: Db,
  user: User,
  objectId: string,
): Promise<ActionResult<{ object: typeof objects.$inferSelect; game: Game }>> {
  if (!isUuid(objectId)) return fail("NOT_FOUND", "Object not found");

  const [pointer] = await db.select({ gameId: objects.gameId }).from(objects).where(eq(objects.id, objectId));
  if (!pointer) return fail("NOT_FOUND", "Object not found");
  const [game] = await db.select().from(games).where(eq(games.id, pointer.gameId)).for("update");
  if (!game) return fail("NOT_FOUND", "Object not found");
  if (game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can do that");
  const draft = requireDraft(game);
  if (!draft.ok) return draft;
  const [object] = await db.select().from(objects).where(eq(objects.id, objectId));
  if (!object) return fail("NOT_FOUND", "Object not found");
  return ok({ object, game });
}

export async function updateObject(
  db: Database,
  user: User,
  objectId: string,
  input: {
    label?: string;
    prompt?: string;
    sourceImageKey?: string;
    requestedScale?: Normalized | null;
    x?: Normalized;
    y?: Normalized;
    radius?: Normalized;
  },
): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedObject(tx, user, objectId);
    if (!owned.ok) return owned;
    const set: Partial<typeof objects.$inferInsert> = {};
    if (input.label !== undefined) {
      const l = validateLabel(input.label);
      if (!l.ok) return l;
      set.label = l.data;
    }
    if (input.prompt !== undefined) {
      const p = validatePrompt(input.prompt);
      if (!p.ok) return p;
      set.prompt = p.data;
    }
    if (input.sourceImageKey !== undefined) {
      if (!isOwnedKey("object", owned.data.game.id, input.sourceImageKey)) {
        return fail("INVALID_INPUT", "Image key does not belong to this game");
      }
      set.sourceImageKey = input.sourceImageKey;
    }
    if (input.requestedScale !== undefined) set.requestedScale = input.requestedScale;
    const positional = [input.x, input.y, input.radius];
    if (positional.some((v) => v !== undefined)) {
      if (positional.some((v) => v === undefined)) return fail("INVALID_INPUT", "x, y and radius must be set together");
      // Handoff rule: a new position invalidates any previous confirmation.
      Object.assign(set, { x: input.x, y: input.y, radius: input.radius, confirmed: false });
    }
    if (Object.keys(set).length === 0) return ok(null);
    await tx.update(objects).set(set).where(eq(objects.id, objectId));
    return ok(null);
  });
}

export async function confirmObject(db: Database, user: User, objectId: string): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedObject(tx, user, objectId);
    if (!owned.ok) return owned;
    if (owned.data.object.x === null) return fail("INVALID_INPUT", "The object has no position to confirm");
    await tx.update(objects).set({ confirmed: true }).where(eq(objects.id, objectId));
    return ok(null);
  });
}

export async function removeObject(db: Database, user: User, objectId: string): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedObject(tx, user, objectId);
    if (!owned.ok) return owned;
    const { object } = owned.data;
    await tx.delete(objects).where(eq(objects.id, objectId));
    await tx
      .update(objects)
      .set({ sortOrder: sql`${objects.sortOrder} - 1` })
      .where(and(eq(objects.gameId, object.gameId), gt(objects.sortOrder, object.sortOrder)));
    return ok(null);
  });
}

export async function setWindow(
  db: Database,
  user: User,
  gameId: string,
  input: { startsAt: Date; endsAt: Date },
  now: Date,
): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const draft = await loadOwnedDraft(tx, user, gameId);
    if (!draft.ok) return draft;
    const w = validateWindow(input.startsAt, input.endsAt, now);
    if (!w.ok) return w;
    await tx.update(games).set({ startsAt: w.data.startsAt, endsAt: w.data.endsAt, updatedAt: now }).where(eq(games.id, gameId));
    return ok(null);
  });
}

/** Invariant 4: the check and the write happen in one transaction with the game row locked. */
export async function publishGame(
  db: Database,
  user: User,
  gameId: string,
  now: Date,
): Promise<ActionResult<{ publishedAt: Date }>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedGame(tx, user, gameId, true);
    if (!owned.ok) return owned;
    const game = owned.data;
    const objs = await tx.select({ confirmed: objects.confirmed }).from(objects).where(eq(objects.gameId, gameId)).orderBy(asc(objects.sortOrder));
    const pre = publishPreconditions(game, objs);
    if (!pre.ok) return pre;
    // publishPreconditions guarantees both are non-null.
    const w = validateWindow(game.startsAt as Date, game.endsAt as Date, now);
    if (!w.ok) return w;
    // Belt-and-braces on the one write that carries invariant 4: only succeed if the row
    // was still a draft at write time, and prove it via the returned row rather than
    // trusting the read above.
    const [row] = await tx
      .update(games)
      .set({ publishedAt: now, updatedAt: now })
      .where(and(eq(games.id, gameId), isNull(games.publishedAt)))
      .returning({ publishedAt: games.publishedAt });
    if (!row || row.publishedAt === null) return fail("NOT_DRAFT", "Game is already published");
    return ok({ publishedAt: row.publishedAt });
  });
}

/** Allowed only while `scheduled`; an active or finished game is immutable (SPEC §10). */
export async function unpublishGame(db: Database, user: User, gameId: string, now: Date): Promise<ActionResult<null>> {
  const owned = await loadOwnedGame(db, user, gameId);
  if (!owned.ok) return owned;
  if (deriveStatus(owned.data, now) !== "scheduled") return fail("NOT_DRAFT", "Only a scheduled game can be unpublished");
  // Conditional write mirrors the check above rather than trusting it: only a still-scheduled
  // row (published, and its window hasn't started yet) is actually cleared.
  const rows = await db
    .update(games)
    .set({ publishedAt: null, updatedAt: now })
    .where(and(eq(games.id, gameId), isNotNull(games.publishedAt), gt(games.startsAt, now)))
    .returning({ id: games.id });
  if (rows.length === 0) return fail("NOT_DRAFT", "Only a scheduled game can be unpublished");
  return ok(null);
}

/**
 * Called by the generation job (imagegen stream), never by a user action — there is no
 * `User` to check ownership against. Locks the game row (invariant 4's lock discipline)
 * so this can't race a concurrent publish, writes the new generated image, and resets
 * every object's `confirmed` flag since a new image invalidates every prior position
 * review — proposals from this run are applied, everything else just loses confirmation.
 */
export async function setGeneratedImage(
  db: Database,
  gameId: string,
  input: { key: string; width: number; height: number },
  proposals: ReadonlyArray<{ objectId: string; x: Normalized; y: Normalized; radius: Normalized }>,
): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    if (!isUuid(gameId)) return fail("NOT_FOUND", "Game not found");
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
    if (!game) return fail("NOT_FOUND", "Game not found");
    if (game.publishedAt !== null) return fail("NOT_DRAFT", "Game is already published");
    if (!isOwnedKey("generated", gameId, input.key)) return fail("INVALID_INPUT", "Image key does not belong to this game");

    await tx
      .update(games)
      .set({ generatedImageKey: input.key, imageWidth: input.width, imageHeight: input.height, updatedAt: new Date() })
      .where(eq(games.id, gameId));

    // Every object loses its confirmation against the old image...
    await tx.update(objects).set({ confirmed: false }).where(eq(objects.gameId, gameId));
    // ...and the ones this run proposed a position for get it, still unconfirmed until
    // the master reviews it.
    for (const p of proposals) {
      await tx
        .update(objects)
        .set({ x: p.x, y: p.y, radius: p.radius, confirmed: false })
        .where(and(eq(objects.id, p.objectId), eq(objects.gameId, gameId)));
    }
    return ok(null);
  });
}
