import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { games, generationRuns, objects, users, type User } from "@/db/schema";
import { addObject, confirmObject, createGame, publishGame, setWindow, updateGame } from "@/lib/games/games";
import { MAX_GENERATION_ATTEMPTS, normalized } from "@/lib/types";
import type { GenerationBackend } from "../backend";
import { createPasteBackend } from "../paste";
import { runGeneration, startGeneration, type RunDeps } from "../run";
import { STALE_REASON } from "../status";

const { db, close } = createTestDb();
afterAll(close);

const FIX = (f: string) => new Uint8Array(readFileSync(`src/db/seed/fixtures/${f}`));
const store = new Map<string, Uint8Array>();
const deps: RunDeps = {
  now: () => new Date(),
  getObject: async (key) => {
    const v = store.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  },
  putObject: async (key, _ct, body) => {
    store.set(key, body);
  },
};

async function draft(master: User, objectCount = 2, background: Uint8Array = FIX("background.png")): Promise<string> {
  const g = await createGame(db, master, { title: "g", generalPrompt: "" });
  if (!g.ok) throw new Error(g.message);
  const bgKey = `games/${g.data.id}/background/bg.png`;
  store.set(bgKey, background);
  await updateGame(db, master, g.data.id, { backgroundKey: bgKey });
  for (let i = 0; i < objectCount; i++) {
    const key = `games/${g.data.id}/object/o${i}.png`;
    store.set(key, FIX(`object-${i + 1}.png`));
    const o = await addObject(db, master, g.data.id, { label: `Object ${i}`, prompt: "", sourceImageKey: key, requestedScale: normalized(0.1) });
    if (!o.ok) throw new Error(o.message);
  }
  return g.data.id;
}

let master: User;
beforeEach(async () => {
  await truncateAll(db);
  store.clear();
  [master] = await db.insert(users).values({ id: "m1", email: "m1@test", name: "M" }).returning();
});

describe("startGeneration", () => {
  it("rejects a game without a background or objects, and a published game", async () => {
    const g = await createGame(db, master, { title: "g", generalPrompt: "" });
    if (!g.ok) throw new Error();
    expect((await startGeneration(db, master, g.data.id, new Date())).ok).toBe(false);

    // A published game: generate for real, confirm every object, set a window, publish.
    const id = await draft(master);
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: createPasteBackend() }, deps);
    for (const o of await db.select().from(objects).where(eq(objects.gameId, id))) {
      const c = await confirmObject(db, master, o.id);
      if (!c.ok) throw new Error(c.message);
    }
    const startsAt = new Date(Date.now() + 60 * 60_000);
    const now = new Date(startsAt.getTime() - 60 * 60_000);
    const w = await setWindow(db, master, id, { startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000) }, now);
    if (!w.ok) throw new Error(w.message);
    const p = await publishGame(db, master, id, now);
    if (!p.ok) throw new Error(p.message);
    expect(await startGeneration(db, master, id, new Date())).toMatchObject({ ok: false, error: "NOT_DRAFT" });
  });
  it("inserts a queued run with the composed prompt and refuses a second start while one is running", async () => {
    const id = await draft(master);
    const first = await startGeneration(db, master, id, new Date());
    expect(first.ok).toBe(true);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(row.status).toBe("queued");
    expect(row.attemptNumber).toBe(1);
    expect(row.promptUsed).toContain("Object 0");
    const second = await startGeneration(db, master, id, new Date());
    expect(second).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
  it("allows a new start when the previous run is stale", async () => {
    const id = await draft(master);
    const first = await startGeneration(db, master, id, new Date(Date.now() - 11 * 60_000));
    expect(first.ok).toBe(true);
    const second = await startGeneration(db, master, id, new Date());
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.attemptNumber).toBe(2);
  });
});

describe("startGeneration guards", () => {
  it("finalizes a stale run before starting a new one", async () => {
    const id = await draft(master);
    const stale = await startGeneration(db, master, id, new Date(Date.now() - 11 * 60_000));
    if (!stale.ok) throw new Error(stale.message);
    const next = await startGeneration(db, master, id, new Date());
    expect(next.ok).toBe(true);
    const rows = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id)).orderBy(generationRuns.attemptNumber);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failureReason).toBe(STALE_REASON);
    expect(rows[0].finishedAt).not.toBeNull();
    expect(rows[1].status).toBe("queued");
  });
  it("refuses a second loop while one is running on another of the master's games", async () => {
    const a = await draft(master);
    const b = await draft(master);
    expect((await startGeneration(db, master, a, new Date())).ok).toBe(true);
    expect(await startGeneration(db, master, b, new Date())).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      message: "A generation is already running on another of your games",
    });
  });
  it("enforces the daily cap across the master's games", async () => {
    const a = await draft(master);
    const paste = createPasteBackend();
    for (let i = 0; i < 2; i++) {
      const s = await startGeneration(db, master, a, new Date(), { dailyCap: 2 });
      if (!s.ok) throw new Error(s.message);
      await runGeneration(db, a, s.data.runId, { ok: true, backend: paste }, deps);
    }
    expect(await startGeneration(db, master, a, new Date(), { dailyCap: 2 })).toMatchObject({
      ok: false,
      message: "Daily generation limit reached (2 attempts per 24 h)",
    });
    // another master is unaffected
    const [other] = await db.insert(users).values({ id: "m2", email: "m2@test", name: "M2" }).returning();
    const c = await draft(other);
    expect((await startGeneration(db, other, c, new Date(), { dailyCap: 2 })).ok).toBe(true);
  });
});

describe("runGeneration", () => {
  it("with the paste backend: passes on attempt 1, sets the image and unconfirmed positions, records the evidence", async () => {
    const id = await draft(master);
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: createPasteBackend() }, deps);

    const [run] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(run.status).toBe("passed");
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    const evidence = run.visionResponse as { imageKey: string; width: number; height: number; candidates: unknown[]; labels: unknown[]; raw: { locate: unknown } };
    expect(evidence.imageKey).toMatch(new RegExp(`^games/${id}/generated/`));
    expect(store.has(evidence.imageKey)).toBe(true);
    expect(evidence.candidates.length).toBeGreaterThanOrEqual(2);
    // The diff found every object, so the localisation fallback was never asked.
    expect(evidence.raw.locate).toBeNull();

    const [game] = await db.select().from(games).where(eq(games.id, id));
    expect(game.generatedImageKey).toBe(evidence.imageKey);
    expect(game.imageWidth).toBe(1024);
    expect(game.imageHeight).toBe(768);
    const objs = await db.select().from(objects).where(eq(objects.gameId, id));
    for (const o of objs) {
      expect(o.x).not.toBeNull();
      expect(o.radius).not.toBeNull();
      expect(o.confirmed).toBe(false);
    }

    // A late or duplicate `after()` must not start a second loop on a row that is no longer queued.
    await runGeneration(db, id, started.data.runId, { ok: true, backend: createPasteBackend() }, deps);
    const rows = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("passed");
    expect(rows[0].promptUsed).toBe(run.promptUsed);
  });

  it("with a backend whose labels never match: fails, retries once with the adjustment, then stops when nothing new is added; image untouched", async () => {
    const id = await draft(master);
    const paste = createPasteBackend();
    const silent: GenerationBackend = { name: "silent", compose: (i) => paste.compose(i), label: async () => ({ labels: [], raw: { silent: true } }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: silent }, deps);

    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id)).orderBy(generationRuns.attemptNumber);
    // Attempt 2 carries attempt 1's adjustment and fails the same way, so it adds nothing new
    // and the loop stops there rather than sending an unchanged prompt a third time.
    expect(runs.length).toBeLessThan(MAX_GENERATION_ATTEMPTS);
    expect(runs.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(runs[0].failureReason).toMatch(/^absent: Object 0 — /);
    expect(runs[0].adjustment).toContain("Place the Object 0");
    expect(runs[1].promptUsed).toContain("Adjustment: Place the Object 0");
    expect(runs[1].adjustment).toBeNull();
    expect(runs[1].failureReason).toMatch(/no new adjustment; not retrying$/);
    for (const r of runs) {
      expect(r.finishedAt).not.toBeNull();
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.visionResponse).toMatchObject({ width: 1024, height: 768 });
    }
    const [game] = await db.select().from(games).where(eq(games.id, id));
    expect(game.generatedImageKey).toBeNull();
  });

  it("records a config failure when no backend is available", async () => {
    const id = await draft(master);
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: false, reason: "config: GEMINI_API_KEY not set" }, deps);
    const [run] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(run.status).toBe("failed");
    expect(run.failureReason).toBe("config: GEMINI_API_KEY not set");
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.visionResponse).toBeNull();
  });

  it("records a thrown backend error on the row, with the prompt that was actually sent, and stops", async () => {
    // A portrait background: the prompt sent carries the letterbox-band sentence, which the
    // queued row (composed before the bytes were read) could not know about.
    const portrait = new Uint8Array(await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer());
    const id = await draft(master, 2, portrait);
    const boom: GenerationBackend = { name: "boom", compose: async () => { throw new Error("quota exceeded"); }, label: async () => ({ labels: [], raw: null }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: boom }, deps);
    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].failureReason).toBe("error: quota exceeded");
    expect(runs[0].promptUsed).toContain("The flat grey bands at the edges are empty space");
    expect(runs[0].finishedAt).not.toBeNull();
    expect(runs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(runs[0].visionResponse).toBeNull();
  });
});
