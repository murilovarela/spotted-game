import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { games, generationRuns, objects, users } from "@/db/schema";
import { normalized } from "@/lib/types";
import { listGamesForMaster, loadGameForMasterById, loadGameForViewer } from "../queries";

const { db, close } = createTestDb();
const identityResolver = async () => (k: string) => `url:${k}`;
const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
let gameId: string;

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(users).values([{ id: "u_master", email: "m@x.co" }, { id: "u_player", email: "p@x.co" }]);
  [{ id: gameId }] = await db.insert(games).values({
    publicId: "abcdefghijklmnopqrstu", masterId: "u_master", title: "K",
    generatedImageKey: "gen/k.png", imageWidth: 1000, imageHeight: 800,
    startsAt, endsAt, publishedAt: ms(startsAt, -86_400_000),
  }).returning({ id: games.id });
  await db.insert(objects).values({ gameId, label: "mug", sourceImageKey: "obj/m.png", sortOrder: 0, x: normalized(0.5), y: normalized(0.5), radius: normalized(0.05), confirmed: true });
  await db.insert(generationRuns).values({ gameId, attemptNumber: 1, status: "passed", promptUsed: "p" });
});
afterAll(() => close());

describe("loadGameForViewer", () => {
  it("returns null for a player before starts_at, a view at starts_at", async () => {
    expect(await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_player", ms(startsAt, -1), identityResolver)).toBeNull();
    const v = await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_player", startsAt, identityResolver);
    expect(v?.status).toBe("active");
    expect(JSON.stringify(v)).not.toMatch(/"x"|"radius"/);
    expect(v?.viewer === "player" && v.image.url).toBe("url:gen/k.png");
  });
  it("returns the master view with runs at any time", async () => {
    const v = await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_master", ms(startsAt, -1), identityResolver);
    expect(v?.viewer).toBe("master");
    if (v?.viewer !== "master") return;
    expect(v.generationRuns).toHaveLength(1);
    expect(v.objects[0]).toMatchObject({ x: 0.5, confirmed: true });
  });
  it("returns null for an unknown publicId", async () => {
    expect(await loadGameForViewer(db, "zzzzzzzzzzzzzzzzzzzzz", "u_master", startsAt, identityResolver)).toBeNull();
  });
});

describe("listGamesForMaster", () => {
  it("lists only the caller's games with derived status", async () => {
    const list = await listGamesForMaster(db, "u_master", ms(endsAt, 1));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: gameId, status: "finished" });
    expect(await listGamesForMaster(db, "u_player", startsAt)).toEqual([]);
  });
});

describe("loadGameForMasterById", () => {
  it("returns the master view for the owning master", async () => {
    const v = await loadGameForMasterById(db, gameId, "u_master", startsAt, identityResolver);
    expect(v?.viewer).toBe("master");
    expect(v?.id).toBe(gameId);
  });
  it("returns null for a non-owning user", async () => {
    expect(await loadGameForMasterById(db, gameId, "u_player", startsAt, identityResolver)).toBeNull();
  });
  it("returns null for a malformed id", async () => {
    expect(await loadGameForMasterById(db, "not-a-uuid", "u_master", startsAt, identityResolver)).toBeNull();
  });
});
