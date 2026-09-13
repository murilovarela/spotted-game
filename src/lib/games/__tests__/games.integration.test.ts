import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test";
import { games, objects, users, type User } from "@/db/schema";
import { normalized } from "@/lib/types";
import {
  addObject, confirmObject, createGame, deleteGame, publishGame, removeObject,
  setGeneratedImage, setWindow, unpublishGame, updateGame, updateObject,
} from "../games";

const { db, close } = createTestDb();
const now = new Date("2026-09-13T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);
let master: User;
let other: User;

beforeEach(async () => {
  await truncateAll(db);
  [master, other] = await db
    .insert(users)
    .values([{ id: "u_master", email: "m@x.co" }, { id: "u_other", email: "o@x.co" }])
    .returning();
});
afterAll(() => close());

// Storage keys are namespaced by game id and asset kind (isOwnedKey); tests build them
// from a real gameId rather than using an arbitrary placeholder.
const backgroundKeyFor = (gameId: string) => `games/${gameId}/background/a.png`;
const objectKeyFor = (gameId: string, name: string) => `games/${gameId}/object/${name}.png`;
const generatedKeyFor = (gameId: string, name: string) => `games/${gameId}/generated/${name}.png`;

async function draftWithConfirmedObject() {
  const g = await createGame(db, master, { title: "Kitchen", generalPrompt: "" });
  if (!g.ok) throw new Error(g.message);
  await updateGame(db, master, g.data.id, { backgroundKey: backgroundKeyFor(g.data.id) });
  await db.update(games).set({ generatedImageKey: generatedKeyFor(g.data.id, "1"), imageWidth: 1000, imageHeight: 800 }).where(eq(games.id, g.data.id));
  const o = await addObject(db, master, g.data.id, { label: "mug", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "m") });
  if (!o.ok) throw new Error(o.message);
  await updateObject(db, master, o.data.id, { x: normalized(0.5), y: normalized(0.5), radius: normalized(0.05) });
  await confirmObject(db, master, o.data.id);
  await setWindow(db, master, g.data.id, { startsAt: later(5), endsAt: later(65) }, now);
  return { gameId: g.data.id, objectId: o.data.id };
}

describe("createGame", () => {
  it("creates a draft with a 21-char publicId owned by the caller", async () => {
    const r = await createGame(db, master, { title: "  Kitchen ", generalPrompt: "moody" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.publicId).toHaveLength(21);
    const [row] = await db.select().from(games).where(eq(games.id, r.data.id));
    expect(row).toMatchObject({ title: "Kitchen", masterId: master.id, publishedAt: null });
  });
  it("rejects an empty title", async () => {
    expect(await createGame(db, master, { title: " ", generalPrompt: "" })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("ownership", () => {
  it("a non-master gets NOT_MASTER, a missing game NOT_FOUND", async () => {
    const { gameId } = await draftWithConfirmedObject();
    expect(await updateGame(db, other, gameId, { title: "x" })).toMatchObject({ error: "NOT_MASTER" });
    expect(await updateGame(db, master, "00000000-0000-4000-8000-000000000000", { title: "x" })).toMatchObject({ error: "NOT_FOUND" });
  });

  it("a malformed id is NOT_FOUND rather than throwing", async () => {
    expect(await updateGame(db, master, "not-a-uuid", { title: "x" })).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });
});

describe("objects", () => {
  it("caps at five objects and assigns sortOrder sequentially", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    for (let i = 0; i < 5; i++) {
      expect((await addObject(db, master, g.data.id, { label: `o${i}`, prompt: "", sourceImageKey: objectKeyFor(g.data.id, `k${i}`) })).ok).toBe(true);
    }
    expect(await addObject(db, master, g.data.id, { label: "six", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "k6") })).toMatchObject({ error: "TOO_MANY_OBJECTS" });
    const rows = await db.select({ sortOrder: objects.sortOrder }).from(objects).where(eq(objects.gameId, g.data.id)).orderBy(objects.sortOrder);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("a position write resets confirmed (handoff rule)", async () => {
    const { objectId } = await draftWithConfirmedObject();
    let [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row.confirmed).toBe(true);
    await updateObject(db, master, objectId, { x: normalized(0.6), y: normalized(0.5), radius: normalized(0.05) });
    [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row).toMatchObject({ confirmed: false, x: 0.6 });
  });

  it("a label-only write keeps confirmed", async () => {
    const { objectId } = await draftWithConfirmedObject();
    await updateObject(db, master, objectId, { label: "cup" });
    const [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row).toMatchObject({ confirmed: true, label: "cup" });
  });

  it("confirm requires a position", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    const o = await addObject(db, master, g.data.id, { label: "o", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "o") });
    if (!o.ok) throw new Error();
    expect(await confirmObject(db, master, o.data.id)).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("removeObject deletes and compacts sortOrder", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await addObject(db, master, g.data.id, { label: `o${i}`, prompt: "", sourceImageKey: objectKeyFor(g.data.id, `k${i}`) });
      if (!o.ok) throw new Error();
      ids.push(o.data.id);
    }
    await removeObject(db, master, ids[1]);
    const rows = await db.select({ id: objects.id, sortOrder: objects.sortOrder }).from(objects).where(eq(objects.gameId, g.data.id)).orderBy(objects.sortOrder);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
    expect(rows.map((r) => r.id)).toEqual([ids[0], ids[2]]);
  });
});

describe("publishGame", () => {
  it("publishes a fully confirmed draft", async () => {
    const { gameId } = await draftWithConfirmedObject();
    const r = await publishGame(db, master, gameId, now);
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(games).where(eq(games.id, gameId));
    expect(row.publishedAt).not.toBeNull();
  });

  it("rejects with UNCONFIRMED_OBJECTS and writes nothing (invariant 4)", async () => {
    const { gameId, objectId } = await draftWithConfirmedObject();
    await updateObject(db, master, objectId, { x: normalized(0.4), y: normalized(0.4), radius: normalized(0.05) });
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ ok: false, error: "UNCONFIRMED_OBJECTS" });
    const [row] = await db.select().from(games).where(eq(games.id, gameId));
    expect(row.publishedAt).toBeNull();
  });

  it("rejects without an image, without objects, and when already published", async () => {
    const { gameId } = await draftWithConfirmedObject();
    await db.update(games).set({ generatedImageKey: null, imageWidth: null, imageHeight: null }).where(eq(games.id, gameId));
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ error: "NO_IMAGE" });
    await db.update(games).set({ generatedImageKey: "k", imageWidth: 1, imageHeight: 1 }).where(eq(games.id, gameId));
    expect((await publishGame(db, master, gameId, now)).ok).toBe(true);
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ error: "NOT_DRAFT" });
  });

  it("rejects a window whose start is already past at publish time", async () => {
    const { gameId } = await draftWithConfirmedObject();
    expect(await publishGame(db, master, gameId, later(10))).toMatchObject({ error: "INVALID_WINDOW" });
  });
});

describe("concurrency (invariant 4)", () => {
  it("a game-row lock held by one transaction blocks a concurrent draft mutation, which then sees the committed publish", async () => {
    const { gameId, objectId } = await draftWithConfirmedObject();

    // A second connection, separate from `db`, so we can hold a transaction open on it
    // while issuing queries against `db` from the test body.
    const { db: db2, close: close2 } = createTestDb();
    try {
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });

      const holder = db2.transaction(async (tx) => {
        await tx.select().from(games).where(eq(games.id, gameId)).for("update");
        signalLocked();
        await gate; // hold the lock open until the test releases it
        // Still holding the lock: commit the publish before releasing it, so the waiter
        // below can only proceed once this is already true.
        await tx.update(games).set({ publishedAt: now, updatedAt: now }).where(eq(games.id, gameId));
      });

      await locked; // the holder has the FOR UPDATE lock on the games row

      const pending = updateObject(db, master, objectId, { label: "x" });
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false); // still blocked behind the game-row lock

      releaseGate();
      await holder; // commits publishedAt, releasing the lock

      expect(await pending).toMatchObject({ ok: false, error: "NOT_DRAFT" });
    } finally {
      await close2();
    }
  });
});

describe("storage key ownership", () => {
  it("rejects an image key that does not belong to the game (background, object)", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    expect(await updateGame(db, master, g.data.id, { backgroundKey: "games/some-other-game/background/a.png" })).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
    });
    expect(
      await addObject(db, master, g.data.id, { label: "o", prompt: "", sourceImageKey: "games/some-other-game/object/o.png" }),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });

    const o = await addObject(db, master, g.data.id, { label: "o", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "o") });
    if (!o.ok) throw new Error();
    expect(await updateObject(db, master, o.data.id, { sourceImageKey: "games/some-other-game/object/o2.png" })).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
    });
  });
});

describe("setGeneratedImage", () => {
  it("writes dims, applies proposed positions, and resets confirmed for every object (even ones without a proposal)", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    const a = await addObject(db, master, g.data.id, { label: "a", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "a") });
    const b = await addObject(db, master, g.data.id, { label: "b", prompt: "", sourceImageKey: objectKeyFor(g.data.id, "b") });
    if (!a.ok || !b.ok) throw new Error();
    await updateObject(db, master, a.data.id, { x: normalized(0.1), y: normalized(0.1), radius: normalized(0.02) });
    await confirmObject(db, master, a.data.id);

    const key = generatedKeyFor(g.data.id, "gen");
    const r = await setGeneratedImage(
      db,
      g.data.id,
      { key, width: 1200, height: 900 },
      [{ objectId: b.data.id, x: normalized(0.6), y: normalized(0.7), radius: normalized(0.03) }],
    );
    expect(r.ok).toBe(true);

    const [row] = await db.select().from(games).where(eq(games.id, g.data.id));
    expect(row).toMatchObject({ generatedImageKey: key, imageWidth: 1200, imageHeight: 900 });

    const rows = await db.select().from(objects).where(eq(objects.gameId, g.data.id)).orderBy(objects.sortOrder);
    // `a` had a confirmed position but no proposal this run: position untouched, confirmed reset.
    expect(rows[0]).toMatchObject({ x: 0.1, y: 0.1, radius: 0.02, confirmed: false });
    // `b` got this run's proposed position, also unconfirmed.
    expect(rows[1]).toMatchObject({ x: 0.6, y: 0.7, radius: 0.03, confirmed: false });
  });

  it("rejects a published game with NOT_DRAFT", async () => {
    const { gameId } = await draftWithConfirmedObject();
    await publishGame(db, master, gameId, now);
    const key = generatedKeyFor(gameId, "gen2");
    expect(await setGeneratedImage(db, gameId, { key, width: 100, height: 100 }, [])).toMatchObject({ ok: false, error: "NOT_DRAFT" });
  });

  it("rejects a key that does not belong to the game with INVALID_INPUT", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    expect(
      await setGeneratedImage(db, g.data.id, { key: "games/some-other-game/generated/gen.png", width: 100, height: 100 }, []),
    ).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("after publish", () => {
  it("draft-only mutations are refused; unpublish works only while scheduled", async () => {
    const { gameId, objectId } = await draftWithConfirmedObject();
    await publishGame(db, master, gameId, now);
    expect(await updateObject(db, master, objectId, { label: "x" })).toMatchObject({ error: "NOT_DRAFT" });
    expect(await addObject(db, master, gameId, { label: "x", prompt: "", sourceImageKey: "k" })).toMatchObject({ error: "NOT_DRAFT" });
    expect(await deleteGame(db, master, gameId)).toMatchObject({ error: "NOT_DRAFT" });
    expect((await unpublishGame(db, master, gameId, later(1))).ok).toBe(true);       // still scheduled
    await publishGame(db, master, gameId, now);
    expect(await unpublishGame(db, master, gameId, later(10))).toMatchObject({ error: "NOT_DRAFT" }); // active now
  });
});
