import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test";
import { attempts, games, markers, objects, users, type User } from "@/db/schema";
import { normalized, type NormalizedPoint } from "@/lib/types";
import { getLeaderboard, getPlayerState, startAttempt, submitAttempt } from "../play";

const { db, close } = createTestDb();
const PUB = "abcdefghijklmnopqrstu";
const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
const pt = (x: number, y: number): NormalizedPoint => ({ x: normalized(x), y: normalized(y) });
let master: User, p1: User, p2: User;
let gameId: string;

beforeEach(async () => {
  await truncateAll(db);
  [master, p1, p2] = await db.insert(users).values([
    { id: "u_master", email: "m@x.co", name: "M" }, { id: "u_p1", email: "1@x.co", name: "One" }, { id: "u_p2", email: "2@x.co", name: "Two" },
  ]).returning();
  [{ id: gameId }] = await db.insert(games).values({
    publicId: PUB, masterId: master.id, title: "K", generatedImageKey: "g", imageWidth: 1000, imageHeight: 1000,
    startsAt, endsAt, publishedAt: ms(startsAt, -1000),
  }).returning({ id: games.id });
  await db.insert(objects).values([
    { gameId, label: "a", sourceImageKey: "a", sortOrder: 0, x: normalized(0.2), y: normalized(0.2), radius: normalized(0.05), confirmed: true },
    { gameId, label: "b", sourceImageKey: "b", sortOrder: 1, x: normalized(0.8), y: normalized(0.8), radius: normalized(0.05), confirmed: true },
  ]);
});
afterAll(() => close());

describe("startAttempt", () => {
  it("creates one attempt and returns the same startedAt on repeat (server-anchored)", async () => {
    const a = await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const b = await startAttempt(db, p1, PUB, ms(startsAt, 9000));
    expect(a.ok && b.ok && a.data.startedAt.getTime()).toBe(ms(startsAt, 1000).getTime());
    expect(b.ok && b.data.startedAt.getTime()).toBe(ms(startsAt, 1000).getTime());
    expect(await db.select().from(attempts)).toHaveLength(1);
  });
  it("refuses outside the active window, and refuses the master", async () => {
    expect(await startAttempt(db, p1, PUB, ms(startsAt, -1))).toMatchObject({ error: "NOT_ACTIVE" });
    expect(await startAttempt(db, p1, PUB, endsAt)).toMatchObject({ error: "NOT_ACTIVE" });
    expect(await startAttempt(db, master, PUB, ms(startsAt, 1))).toMatchObject({ error: "MASTER_CANNOT_PLAY" });
  });
});

describe("submitAttempt", () => {
  it("scores server-side, stores markers with assignments, returns count and time only", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const r = await submitAttempt(db, p1, PUB, [pt(0.21, 0.2), pt(0.5, 0.5)], ms(startsAt, 4000));
    expect(r).toEqual({ ok: true, data: { foundCount: 1, elapsedMs: 3000 } });
    const rows = await db.select().from(markers);
    expect(rows.map((m) => m.matchedObjectId !== null)).toEqual([true, false]);
  });
  it("rejects a second submission with ALREADY_SUBMITTED and keeps the first score", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    await submitAttempt(db, p1, PUB, [pt(0.21, 0.2), pt(0.5, 0.5)], ms(startsAt, 4000));
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 5000))).toMatchObject({ error: "ALREADY_SUBMITTED" });
    const [a] = await db.select().from(attempts).where(eq(attempts.userId, p1.id));
    expect(a.foundCount).toBe(1);
    expect(await db.select().from(markers)).toHaveLength(2);
  });
  it("requires exactly N markers and a started attempt", async () => {
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2)], ms(startsAt, 4000))).toMatchObject({ error: "NOT_STARTED" });
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2)], ms(startsAt, 4000))).toMatchObject({ error: "WRONG_MARKER_COUNT" });
  });
  it("ignores any client-supplied time: elapsed comes from the DB", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const r = await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 61_000));
    expect(r.ok && r.data.elapsedMs).toBe(60_000);
  });
});

describe("getPlayerState", () => {
  it("walks not_started → in_progress → submitted", async () => {
    expect(await getPlayerState(db, p1, PUB)).toEqual({ ok: true, data: { kind: "not_started" } });
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    expect(await getPlayerState(db, p1, PUB)).toMatchObject({ ok: true, data: { kind: "in_progress" } });
    await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 4000));
    expect(await getPlayerState(db, p1, PUB)).toEqual({ ok: true, data: { kind: "submitted", result: { foundCount: 2, elapsedMs: 3000 } } });
  });
});

describe("getLeaderboard", () => {
  async function play(u: User, pts: NormalizedPoint[], start: number, end: number) {
    await startAttempt(db, u, PUB, ms(startsAt, start));
    await submitAttempt(db, u, PUB, pts, ms(startsAt, end));
  }
  it("is hidden before the viewer submits and visible after; master always sees it", async () => {
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 1000, 9000);
    expect(await getLeaderboard(db, p1, PUB, ms(startsAt, 10_000))).toMatchObject({ error: "LEADERBOARD_HIDDEN" });
    expect(await getLeaderboard(db, null, PUB, ms(startsAt, 10_000))).toMatchObject({ error: "LEADERBOARD_HIDDEN" });
    expect((await getLeaderboard(db, master, PUB, ms(startsAt, 10_000))).ok).toBe(true);
    await play(p1, [pt(0.2, 0.2), pt(0.5, 0.5)], 2000, 4000);
    const r = await getLeaderboard(db, p1, PUB, ms(startsAt, 10_000));
    expect(r.ok && r.data).toEqual([
      { rank: 1, userName: "Two", foundCount: 2, elapsedMs: 8000, isViewer: false },
      { rank: 2, userName: "One", foundCount: 1, elapsedMs: 2000, isViewer: true },
    ]);
  });
  it("is visible to everyone once finished; unsubmitted attempts never appear", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000)); // abandoned
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 1000, 9000);
    const r = await getLeaderboard(db, null, PUB, endsAt);
    expect(r.ok && r.data.map((e) => e.userName)).toEqual(["Two"]);
  });
  it("ranks by found desc then elapsed asc", async () => {
    await play(p1, [pt(0.2, 0.2), pt(0.8, 0.8)], 0, 20_000);
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 0, 10_000);
    const r = await getLeaderboard(db, master, PUB, ms(startsAt, 30_000));
    expect(r.ok && r.data.map((e) => e.userName)).toEqual(["Two", "One"]);
  });
});
