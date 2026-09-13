/**
 * Invariant 1 (CLAUDE.md): coordinates never reach the client while a game is `active`.
 *
 * `projectGame` is the single choke point every read path must go through. It decides
 * viewer and status itself from the user id and the clock, so this test drives those two
 * decisions through their boundaries and asserts that no coordinate key or value survives
 * where the spec says answers are hidden (SPEC §3.2).
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import { games } from "@/db/schema";
import { projectGame, type GameSource, type ObjectSource } from "../visibility";
import { normalized, type ActiveGameView, type AttemptResult, type LeaderboardEntry } from "../types";

const COORDINATE_KEYS = new Set(["x", "y", "radius"]);

// Distinctive values so a leak is detectable by value as well as by key.
const SENTINEL_X = 0.123456;
const SENTINEL_Y = 0.654321;
const SENTINEL_R = 0.098765;

const MASTER = "user_master";
const PLAYER = "user_player";

const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
const identity = (key: string) => key;

const game: GameSource = {
  id: "11111111-1111-4111-8111-111111111111",
  publicId: "abcdefghijklmnopqrstu",
  title: "Kitchen chaos",
  masterId: MASTER,
  generalPrompt: "photoreal, medium difficulty",
  backgroundKey: "bg/kitchen.png",
  generatedImageKey: "gen/kitchen-3.png",
  imageWidth: 1536,
  imageHeight: 1024,
  startsAt,
  endsAt,
  publishedAt: new Date("2026-09-12T10:00:00Z"),
};

const objects: ObjectSource[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    label: "coffee mug",
    prompt: "on the counter",
    sourceImageKey: "obj/mug.png",
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
    sourceImageKey: "obj/duck.png",
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

const view = (userId: string | null, now: Date) => projectGame({ game, objects, userId, now, resolveUrl: identity });

describe("invariant 1: no coordinates while active", () => {
  it.each([
    ["at starts_at", startsAt],
    ["mid-window", ms(startsAt, 30 * 60_000)],
    ["1ms before ends_at", ms(endsAt, -1)],
  ])("a player %s gets a view with no coordinate keys or values", (_, now) => {
    const v = view(PLAYER, now);
    expect(v?.status).toBe("active");
    expectNoCoordinates(v);
  });

  it("an anonymous viewer is treated as a player, not the master", () => {
    const v = view(null, ms(startsAt, 1));
    expect(v?.viewer).toBe("player");
    expectNoCoordinates(v);
  });

  it("a user whose id merely resembles the master's is still a player", () => {
    const v = projectGame({ game, objects, userId: `${MASTER} `, now: ms(startsAt, 1), resolveUrl: identity });
    expect(v?.viewer).toBe("player");
    expectNoCoordinates(v);
  });

  it("an active game still carries the image and every object thumbnail, with keys resolved to URLs", () => {
    const sign = (key: string) => `https://cdn.example/${key}?sig=abc`;
    const v = projectGame({ game, objects, userId: PLAYER, now: ms(startsAt, 1), resolveUrl: sign });
    expect(v?.status).toBe("active");
    if (v?.status !== "active") return;
    expect(v.image).toEqual({ url: sign("gen/kitchen-3.png"), width: 1536, height: 1024 });
    expect(v.objects.map((o) => o.id)).toEqual(objects.map((o) => o.id));
    expect(v.objects.map((o) => o.sourceImageUrl)).toEqual(objects.map((o) => sign(o.sourceImageKey)));
    expect(JSON.stringify(v)).not.toContain('"gen/kitchen-3.png"');
  });

  it("the ActiveGameView type has no coordinate fields", () => {
    type ActiveObject = ActiveGameView["objects"][number];
    expectTypeOf<ActiveObject>().not.toHaveProperty("x");
    expectTypeOf<ActiveObject>().not.toHaveProperty("y");
    expectTypeOf<ActiveObject>().not.toHaveProperty("radius");
  });

  it("a player cannot see a draft or scheduled game at all", () => {
    expect(view(PLAYER, ms(startsAt, -1))).toBeNull();
    expect(projectGame({ game: { ...game, publishedAt: null }, objects, userId: PLAYER, now: ms(startsAt, 1), resolveUrl: identity })).toBeNull();
  });
});

describe("answers are revealed where the spec says they are", () => {
  it("a player sees positions from ends_at onward, and not 1ms before", () => {
    expectNoCoordinates(view(PLAYER, ms(endsAt, -1)));
    const v = view(PLAYER, endsAt);
    expect(v?.status).toBe("finished");
    if (v?.status !== "finished") return;
    expect(v.objects[0]).toMatchObject({ x: SENTINEL_X, y: SENTINEL_Y, radius: SENTINEL_R });
  });

  it.each([
    ["draft", { ...game, publishedAt: null }, startsAt],
    ["scheduled", game, ms(startsAt, -1)],
    ["active", game, ms(startsAt, 1)],
    ["finished", game, endsAt],
  ] as const)("the master sees positions on a %s game", (status, g, now) => {
    const v = projectGame({ game: g, objects, userId: MASTER, now, resolveUrl: identity });
    expect(v?.status).toBe(status);
    expect(v?.viewer).toBe("master");
    if (v?.viewer !== "master") return;
    expect(v.objects[0]).toMatchObject({ x: SENTINEL_X, y: SENTINEL_Y, radius: SENTINEL_R, confirmed: true });
  });

  it("the master view carries a null position for an object that has not been generated yet", () => {
    const pending: ObjectSource = { ...objects[0], x: null, y: null, radius: null, confirmed: false };
    const v = projectGame({ game: { ...game, publishedAt: null }, objects: [pending], userId: MASTER, now: startsAt, resolveUrl: identity });
    if (v?.viewer !== "master") throw new Error("expected master view");
    expect(v.objects[0]).toMatchObject({ x: null, y: null, radius: null, confirmed: false });
  });

  it("the master sees generation runs; players never do", () => {
    const runs = [
      { attemptNumber: 2, status: "passed" as const, failureReason: null, adjustment: null, startedAt: startsAt, finishedAt: startsAt },
      { attemptNumber: 1, status: "failed" as const, failureReason: "object absent from diff", adjustment: "raise prominence", startedAt: startsAt, finishedAt: startsAt },
    ];
    const master = projectGame({ game, objects, generationRuns: runs, userId: MASTER, now: startsAt, resolveUrl: identity });
    if (master?.viewer !== "master") throw new Error("expected master view");
    expect(master.generationRuns.map((r) => r.attemptNumber)).toEqual([1, 2]);
    const player = projectGame({ game, objects, generationRuns: runs, userId: PLAYER, now: startsAt, resolveUrl: identity });
    expect(collectKeys(player).has("generationRuns")).toBe(false);
  });
});

describe("attempt and leaderboard shapes carry no per-marker information", () => {
  it("AttemptResult is count and time only", () => {
    expectTypeOf<AttemptResult>().toEqualTypeOf<{ readonly foundCount: number; readonly elapsedMs: number }>();
  });

  it("LeaderboardEntry has no coordinates or marker data", () => {
    expectTypeOf<LeaderboardEntry>().not.toHaveProperty("x");
    expectTypeOf<LeaderboardEntry>().not.toHaveProperty("markers");
    expectTypeOf<LeaderboardEntry>().not.toHaveProperty("assignments");
  });
});

describe("invariant 3: status is derived, never stored", () => {
  it("the games table has no status column", () => {
    const columns = Object.keys(getTableColumns(games));
    expect(columns).not.toContain("status");
    expect(columns).toEqual(expect.arrayContaining(["startsAt", "endsAt", "publishedAt"]));
  });
});
