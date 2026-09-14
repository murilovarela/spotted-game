/**
 * `npm run seed [-- --json]` — demo games in every lifecycle state (SPEC §9.2) plus a
 * set owned by an opponent so the master account has something to play.
 *
 * Drives the Phase 1 core with a shifted `now` so every row goes through the same
 * validation and locks as the app. Idempotent: deletes games titled "[seed] …" first.
 * Uses DATABASE_URL (not TEST_DATABASE_URL) on purpose — this seeds whatever branch
 * the app points at; CI points DATABASE_URL at the test branch for E2E.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import { createDb, type Database } from "@/db";
import { games, users, type User } from "@/db/schema";
import { addObject, confirmObject, createGame, publishGame, setGeneratedImage, setWindow, updateGame } from "@/lib/games/games";
import { startAttempt, submitAttempt } from "@/lib/games/play";
import { objectKey, putObject } from "@/lib/storage";
import { normalized, type NormalizedPoint } from "@/lib/types";
import spec from "./fixtures/objects.json" with { type: "json" };

loadEnvConfig(process.cwd());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIXTURES = join(process.cwd(), "src/db/seed/fixtures");
const PREFIX = "[seed] ";

type Ref = { id: string; publicId: string };
type Window = { startsAt: Date; endsAt: Date } | null;

function must<T>(r: { ok: true; data: T } | { ok: false; message: string }, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.message}`);
  return r.data;
}

async function ensureUser(db: Database, id: string, name: string): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ id, email: `${id}@spotted.test`, name })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  return existing;
}

async function upload(gameId: string, kind: "background" | "object" | "generated", file: string): Promise<string> {
  const key = objectKey(kind, gameId, "image/png");
  await putObject(key, "image/png", readFileSync(join(FIXTURES, file)));
  return key;
}

/** Create a fully-authored game. `confirmAll=false` leaves the last object unconfirmed. */
async function author(db: Database, master: User, title: string, confirmAll: boolean): Promise<Ref> {
  const ref = must(await createGame(db, master, { title, generalPrompt: "A bright cartoon room. Hide the objects in plain sight." }), title);
  must(await updateGame(db, master, ref.id, { backgroundKey: await upload(ref.id, "background", "background.png") }), "background");
  const proposals = [];
  for (const o of spec.objects) {
    const obj = must(
      await addObject(db, master, ref.id, { label: o.label, prompt: `Place the ${o.label.toLowerCase()} somewhere plausible.`, sourceImageKey: await upload(ref.id, "object", o.file) }),
      o.label,
    );
    proposals.push({ objectId: obj.id, x: normalized(o.x), y: normalized(o.y), radius: normalized(o.radius) });
  }
  const generated = await upload(ref.id, "generated", "generated.png");
  must(await setGeneratedImage(db, ref.id, { key: generated, width: spec.image.width, height: spec.image.height }, proposals), "generated");
  const toConfirm = confirmAll ? proposals : proposals.slice(0, -1);
  for (const p of toConfirm) must(await confirmObject(db, master, p.objectId), "confirm");
  return ref;
}

async function schedule(db: Database, master: User, ref: Ref, window: Window, publish: boolean): Promise<void> {
  if (!window) return;
  // Only windows already in the past need the shift (so starts_at ≥ now for validation);
  // clamp to the real clock otherwise, so published_at/updated_at are never in the future.
  const now = new Date(Math.min(Date.now(), window.startsAt.getTime() - HOUR));
  must(await setWindow(db, master, ref.id, window, now), "window");
  if (publish) must(await publishGame(db, master, ref.id, now), "publish");
}

/** Three players submit inside the window: all found, two found, none found. */
async function playFinished(db: Database, ref: Ref, players: User[], window: NonNullable<Window>): Promise<void> {
  const centre = (i: number): NormalizedPoint => ({ x: normalized(spec.objects[i].x), y: normalized(spec.objects[i].y) });
  const miss: NormalizedPoint = { x: normalized(0.05), y: normalized(0.95) };
  const guesses: NormalizedPoint[][] = [
    [centre(0), centre(1), centre(2)],
    [centre(0), centre(1), miss],
    [miss, miss, miss],
  ];
  for (const [i, player] of players.entries()) {
    const t0 = new Date(window.startsAt.getTime() + (i + 1) * 10 * 60_000);
    must(await startAttempt(db, player, ref.publicId, t0), "start");
    must(await submitAttempt(db, player, ref.publicId, guesses[i], new Date(t0.getTime() + 20_000 + i * 15_000)), "submit");
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);
  const json = process.argv.includes("--json");
  const log = (s: string) => { if (!json) console.log(s); else console.error(s); };

  const masterId = process.env.SEED_MASTER_ID ?? "seed-master";
  const master = await ensureUser(db, masterId, "Seed Master");
  const opponent = await ensureUser(db, "seed-opponent", "Seed Opponent");
  const players = await Promise.all([1, 2, 3].map((n) => ensureUser(db, `seed-player-${n}`, `Player ${n}`)));

  const deleted = await db.delete(games).where(like(games.title, `${PREFIX}%`)).returning({ id: games.id });
  log(`removed ${deleted.length} previous seed game(s)`);

  const now = Date.now();
  const windows = {
    draft: { startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY) },
    scheduled: { startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY) },
    active: { startsAt: new Date(now - HOUR), endsAt: new Date(now + DAY) },
    finished: { startsAt: new Date(now - 2 * DAY), endsAt: new Date(now - HOUR) },
  } as const;

  const mine = {} as Record<keyof typeof windows, Ref>;
  for (const state of ["draft", "scheduled", "active", "finished"] as const) {
    const ref = await author(db, master, `${PREFIX}${state}`, state !== "draft");
    await schedule(db, master, ref, windows[state], state !== "draft");
    if (state === "finished") await playFinished(db, ref, players, windows.finished);
    mine[state] = ref;
    log(`${state.padEnd(9)} /g/${ref.publicId}  (/games/${ref.id})`);
  }

  const theirs = {} as Record<"scheduled" | "active" | "finished", Ref>;
  for (const state of ["scheduled", "active", "finished"] as const) {
    const ref = await author(db, opponent, `${PREFIX}${state} (opponent)`, true);
    await schedule(db, opponent, ref, windows[state], true);
    if (state === "finished") await playFinished(db, ref, players, windows.finished);
    theirs[state] = ref;
    log(`${state.padEnd(9)} /g/${ref.publicId}  (opponent's)`);
  }

  if (json) console.log(JSON.stringify({ masterId, mine, theirs }));
  await db.$client.end();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
