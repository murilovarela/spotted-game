/**
 * Invariant 1 (CLAUDE.md): coordinates never reach the client while a game is `active`.
 *
 * `projectGame` is the single choke point every read path must go through. This test
 * walks its output for every status × viewer combination and asserts that no coordinate
 * key or value survives where the spec says answers are hidden (SPEC §3.2).
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import { games } from "@/db/schema";
import { projectGame, type GameSource, type ObjectSource } from "../visibility";
import { GAME_STATUSES, normalized, type ActiveGameView, type GameStatus } from "../types";

const COORDINATE_KEYS = new Set(["x", "y", "radius"]);

// Distinctive values so a leak is detectable by value as well as by key.
const SENTINEL_X = 0.123456;
const SENTINEL_Y = 0.654321;
const SENTINEL_R = 0.098765;

const game: GameSource = {
  id: "11111111-1111-4111-8111-111111111111",
  publicId: "abcdefghijklmnopqrstu",
  title: "Kitchen chaos",
  masterId: "user_master",
  generalPrompt: "photoreal, medium difficulty",
  backgroundUrl: "https://blob.example/bg.png",
  generatedImageUrl: "https://blob.example/gen.png",
  imageWidth: 1536,
  imageHeight: 1024,
  startsAt: new Date("2026-09-13T10:00:00Z"),
  endsAt: new Date("2026-09-13T11:00:00Z"),
  publishedAt: new Date("2026-09-12T10:00:00Z"),
};

const objects: ObjectSource[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    label: "coffee mug",
    prompt: "on the counter",
    sourceImageUrl: "https://blob.example/mug.png",
    sortOrder: 0,
    x: normalized(SENTINEL_X),
    y: normalized(SENTINEL_Y),
    radius: normalized(SENTINEL_R),
    confirmed: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    label: "rubber duck",
    prompt: "in the sink",
    sourceImageUrl: "https://blob.example/duck.png",
    sortOrder: 1,
    x: normalized(0.4),
    y: normalized(0.6),
    radius: normalized(0.05),
    confirmed: true,
  },
];

/** Every key reachable anywhere in a value, including inside arrays. */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

function expectNoCoordinates(view: unknown) {
  const keys = collectKeys(view);
  for (const key of COORDINATE_KEYS) expect(keys.has(key), `key "${key}" leaked`).toBe(false);
  const json = JSON.stringify(view);
  for (const sentinel of [SENTINEL_X, SENTINEL_Y, SENTINEL_R]) {
    expect(json.includes(String(sentinel)), `value ${sentinel} leaked`).toBe(false);
  }
}

describe("invariant 1: no coordinates while active", () => {
  it("an active game projected for a player carries no coordinate keys or values", () => {
    const view = projectGame({ game, objects, status: "active", viewer: "player" });
    expect(view).not.toBeNull();
    expect(view?.status).toBe("active");
    expectNoCoordinates(view);
  });

  it("an active game still carries the image and every object thumbnail", () => {
    const view = projectGame({ game, objects, status: "active", viewer: "player" });
    expect(view?.status).toBe("active");
    if (view?.status !== "active") return;
    expect(view.image).toEqual({ url: game.generatedImageUrl, width: 1536, height: 1024 });
    expect(view.objects.map((o) => o.id)).toEqual(objects.map((o) => o.id));
    expect(view.objects.map((o) => o.sourceImageUrl)).toEqual(objects.map((o) => o.sourceImageUrl));
  });

  it("the ActiveGameView type has no coordinate fields", () => {
    type ActiveObject = ActiveGameView["objects"][number];
    expectTypeOf<ActiveObject>().not.toHaveProperty("x");
    expectTypeOf<ActiveObject>().not.toHaveProperty("y");
    expectTypeOf<ActiveObject>().not.toHaveProperty("radius");
  });

  it.each<GameStatus>(["draft", "scheduled"])("a %s game is not visible to a player at all", (status) => {
    expect(projectGame({ game, objects, status, viewer: "player" })).toBeNull();
  });

  it("the only player-visible statuses are active and finished", () => {
    const visible = GAME_STATUSES.filter(
      (status) => projectGame({ game, objects, status, viewer: "player" }) !== null,
    );
    expect(visible).toEqual(["active", "finished"]);
  });
});

describe("answers are revealed where the spec says they are", () => {
  it("a finished game reveals confirmed positions to a player", () => {
    const view = projectGame({ game, objects, status: "finished", viewer: "player" });
    expect(view?.status).toBe("finished");
    if (view?.status !== "finished") return;
    expect(view.objects[0]).toMatchObject({ x: SENTINEL_X, y: SENTINEL_Y, radius: SENTINEL_R });
  });

  it.each(GAME_STATUSES)("the master sees positions on a %s game", (status) => {
    const view = projectGame({ game, objects, status, viewer: "master" });
    expect(view?.status).toBe(status);
    expect(view?.viewer).toBe("master");
    if (view?.viewer !== "master") return;
    expect(view.objects[0]).toMatchObject({ x: SENTINEL_X, y: SENTINEL_Y, radius: SENTINEL_R, confirmed: true });
  });

  it("the master view carries a null position for an object that has not been generated yet", () => {
    const pending: ObjectSource = { ...objects[0], x: null, y: null, radius: null, confirmed: false };
    const view = projectGame({ game, objects: [pending], status: "draft", viewer: "master" });
    if (view?.viewer !== "master") throw new Error("expected master view");
    expect(view.objects[0]).toMatchObject({ x: null, y: null, radius: null, confirmed: false });
  });
});

describe("invariant 3: status is derived, never stored", () => {
  it("the games table has no status column", () => {
    const columns = Object.keys(getTableColumns(games));
    expect(columns).not.toContain("status");
    expect(columns).toEqual(expect.arrayContaining(["startsAt", "endsAt", "publishedAt"]));
  });
});
