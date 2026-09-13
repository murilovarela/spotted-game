/**
 * The single choke point between stored game data and anything sent to a client.
 * Every read path — server action, route handler, server component — must project
 * through `projectGame`. It decides for itself who the viewer is and what the status
 * is; callers supply facts (user id, clock), not conclusions. Covered by
 * src/lib/__tests__/invariants.test.ts.
 */
import { deriveStatus } from "./status";
import type {
  GameImage,
  GameView,
  GenerationRunStatus,
  Normalized,
  ObjectForMaster,
  ObjectReveal,
  ObjectThumbnail,
} from "./types";

/** The stored shape of a game, independent of the ORM so this module stays pure. */
export type GameSource = {
  readonly id: string;
  readonly publicId: string;
  readonly title: string;
  readonly masterId: string;
  readonly generalPrompt: string;
  readonly backgroundKey: string | null;
  readonly generatedImageKey: string | null;
  readonly imageWidth: number | null;
  readonly imageHeight: number | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly publishedAt: Date | null;
};

export type ObjectSource = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly sourceImageKey: string;
  readonly sortOrder: number;
  readonly x: Normalized | null;
  readonly y: Normalized | null;
  readonly radius: Normalized | null;
  readonly confirmed: boolean;
};

export type GenerationRunSource = {
  readonly attemptNumber: number;
  readonly status: GenerationRunStatus;
  readonly failureReason: string | null;
  readonly adjustment: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
};

export type ProjectGameInput = {
  readonly game: GameSource;
  readonly objects: readonly ObjectSource[];
  /** Only the master's view carries these; pass `[]` for player reads. */
  readonly generationRuns?: readonly GenerationRunSource[];
  /** The authenticated user, or null for anonymous. Master is decided here, not by the caller. */
  readonly userId: string | null;
  /** The server clock. Status is derived here, not by the caller. */
  readonly now: Date;
  /** Turns a storage key into a URL a browser can load (signed, since the bucket is private). */
  readonly resolveUrl: (key: string) => string;
};

type Ctx = { readonly resolveUrl: (key: string) => string };

function imageOf(game: GameSource, { resolveUrl }: Ctx): GameImage | null {
  if (game.generatedImageKey === null || game.imageWidth === null || game.imageHeight === null) return null;
  return { url: resolveUrl(game.generatedImageKey), width: game.imageWidth, height: game.imageHeight };
}

function thumbnailOf(object: ObjectSource, { resolveUrl }: Ctx): ObjectThumbnail {
  return {
    id: object.id,
    label: object.label,
    sourceImageUrl: resolveUrl(object.sourceImageKey),
    sortOrder: object.sortOrder,
  };
}

function revealOf(object: ObjectSource, ctx: Ctx): ObjectReveal {
  if (object.x === null || object.y === null || object.radius === null) {
    // A published game has only confirmed objects (invariant 4), so this is a data bug, not a state.
    throw new Error(`Object ${object.id} has no confirmed position`);
  }
  return { ...thumbnailOf(object, ctx), x: object.x, y: object.y, radius: object.radius };
}

function forMasterOf(object: ObjectSource, ctx: Ctx): ObjectForMaster {
  return {
    ...thumbnailOf(object, ctx),
    prompt: object.prompt,
    x: object.x,
    y: object.y,
    radius: object.radius,
    confirmed: object.confirmed,
  };
}

function sorted(objects: readonly ObjectSource[]): ObjectSource[] {
  return [...objects].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Project a game for whoever `userId` is at `now`. Returns `null` when the viewer may
 * not see the game at all (SPEC §3.3.1: 404 for anything not yet active, except to its
 * master).
 *
 * | status    | player                         | master     |
 * | --------- | ------------------------------ | ---------- |
 * | draft     | null                           | everything |
 * | scheduled | null                           | everything |
 * | active    | image + thumbnails, no answers | everything |
 * | finished  | image + answers                | everything |
 */
export function projectGame({
  game,
  objects,
  generationRuns = [],
  userId,
  now,
  resolveUrl,
}: ProjectGameInput): GameView | null {
  const ctx: Ctx = { resolveUrl };
  const status = deriveStatus(game, now);
  const base = {
    publicId: game.publicId,
    title: game.title,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
  };

  if (userId !== null && userId === game.masterId) {
    return {
      ...base,
      viewer: "master",
      status,
      id: game.id,
      generalPrompt: game.generalPrompt,
      backgroundUrl: game.backgroundKey === null ? null : resolveUrl(game.backgroundKey),
      image: imageOf(game, ctx),
      publishedAt: game.publishedAt,
      objects: sorted(objects).map((o) => forMasterOf(o, ctx)),
      generationRuns: [...generationRuns]
        .sort((a, b) => a.attemptNumber - b.attemptNumber)
        .map((r) => ({
          attemptNumber: r.attemptNumber,
          status: r.status,
          failureReason: r.failureReason,
          adjustment: r.adjustment,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        })),
    };
  }

  if (status === "draft" || status === "scheduled") return null;

  const image = imageOf(game, ctx);
  if (image === null) {
    // The DB forbids this (games_published_has_image); reaching it is a data bug.
    throw new Error(`Game ${game.id} is ${status} but has no generated image`);
  }

  if (status === "active") {
    return { ...base, viewer: "player", status, image, objects: sorted(objects).map((o) => thumbnailOf(o, ctx)) };
  }

  return { ...base, viewer: "player", status, image, objects: sorted(objects).map((o) => revealOf(o, ctx)) };
}
