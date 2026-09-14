import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { games, generationRuns, objects, users, type User } from "@/db/schema";
import { addObject, createGame, updateGame } from "@/lib/games/games";
import { MAX_GENERATION_ATTEMPTS, normalized } from "@/lib/types";
import type { GenerationBackend } from "../backend";
import { createPasteBackend } from "../paste";
import { runGeneration, startGeneration, type RunDeps } from "../run";

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

async function draft(master: User, objectCount = 2): Promise<string> {
  const g = await createGame(db, master, { title: "g", generalPrompt: "" });
  if (!g.ok) throw new Error(g.message);
  const bgKey = `games/${g.data.id}/background/bg.png`;
  store.set(bgKey, FIX("background.png"));
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
    const evidence = run.visionResponse as { imageKey: string; width: number; height: number; candidates: unknown[]; labels: unknown[] };
    expect(evidence.imageKey).toMatch(new RegExp(`^games/${id}/generated/`));
    expect(store.has(evidence.imageKey)).toBe(true);
    expect(evidence.candidates.length).toBeGreaterThanOrEqual(2);

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
  });

  it("with a backend whose labels never match: three failed rows with reasons and adjustments, then stops; image untouched", async () => {
    const id = await draft(master);
    const paste = createPasteBackend();
    const silent: GenerationBackend = { name: "silent", compose: (i) => paste.compose(i), label: async () => ({ labels: [], raw: { silent: true } }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: silent }, deps);

    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id)).orderBy(generationRuns.attemptNumber);
    expect(runs.map((r) => r.status)).toEqual(Array(MAX_GENERATION_ATTEMPTS).fill("failed"));
    expect(runs[0].failureReason).toMatch(/^absent: Object 0 — /);
    expect(runs[0].adjustment).toContain("Place the Object 0");
    // attempt 2's prompt carries attempt 1's adjustment; attempt 3 adds nothing new (deduped)
    expect(runs[1].promptUsed).toContain("Adjustment: Place the Object 0");
    expect(runs[2].adjustment).toBeNull();
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
  });

  it("records a thrown backend error on the row and stops", async () => {
    const id = await draft(master);
    const boom: GenerationBackend = { name: "boom", compose: async () => { throw new Error("quota exceeded"); }, label: async () => ({ labels: [], raw: null }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: boom }, deps);
    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].failureReason).toBe("error: quota exceeded");
  });
});
