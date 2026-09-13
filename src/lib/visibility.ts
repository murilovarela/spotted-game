/**
 * The single choke point between stored game data and anything sent to a client.
 * Every read path — server action, route handler, server component — must project
 * through `projectGame`. Covered by src/lib/__tests__/invariants.test.ts.
 */
import type {
  GameImage,
  GameStatus,
  GameView,
  Normalized,
  ObjectForMaster,
  ObjectReveal,
  ObjectThumbnail,
  Viewer,
} from "./types";

/** The stored shape of a game, independent of the ORM so this module stays pure. */
export type GameSource = {
  readonly id: string;
  readonly publicId: string;
  readonly title: string;
  readonly masterId: string;
  readonly generalPrompt: string;
  readonly backgroundUrl: string | null;
  readonly generatedImageUrl: string | null;
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
  readonly sourceImageUrl: string;
  readonly sortOrder: number;
  readonly x: Normalized | null;
  readonly y: Normalized | null;
  readonly radius: Normalized | null;
  readonly confirmed: boolean;
};

export type ProjectGameInput = {
  readonly game: GameSource;
  readonly objects: readonly ObjectSource[];
  /** Already derived on read; this module does not look at the clock. */
  readonly status: GameStatus;
  readonly viewer: Viewer;
};

function imageOf(game: GameSource): GameImage | null {
  if (game.generatedImageUrl === null || game.imageWidth === null || game.imageHeight === null) return null;
  return { url: game.generatedImageUrl, width: game.imageWidth, height: game.imageHeight };
}

function thumbnailOf(object: ObjectSource): ObjectThumbnail {
  return {
    id: object.id,
    label: object.label,
    sourceImageUrl: object.sourceImageUrl,
    sortOrder: object.sortOrder,
  };
}

function revealOf(object: ObjectSource): ObjectReveal {
  if (object.x === null || object.y === null || object.radius === null) {
    // A published game has only confirmed objects (invariant 4), so this is a data bug, not a state.
    throw new Error(`Object ${object.id} has no confirmed position`);
  }
  return { ...thumbnailOf(object), x: object.x, y: object.y, radius: object.radius };
}

function forMasterOf(object: ObjectSource): ObjectForMaster {
  return {
    ...thumbnailOf(object),
    prompt: object.prompt,
    x: object.x,
    y: object.y,
    radius: object.radius,
    confirmed: object.confirmed,
  };
}

function sorted(objects: readonly ObjectSource[]): ObjectSource[] {
  return [...objects].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Project a game for a viewer. Returns `null` when the viewer may not see the game at
 * all (SPEC §3.3.1: 404 for anything not yet active, except to its master).
 *
 * | status    | player                      | master     |
 * | --------- | --------------------------- | ---------- |
 * | draft     | null                        | everything |
 * | scheduled | null                        | everything |
 * | active    | image + thumbnails, no answers | everything |
 * | finished  | image + answers             | everything |
 */
export function projectGame({ game, objects, status, viewer }: ProjectGameInput): GameView | null {
  const base = {
    publicId: game.publicId,
    title: game.title,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
  };

  if (viewer === "master") {
    return {
      ...base,
      viewer: "master",
      status,
      id: game.id,
      generalPrompt: game.generalPrompt,
      backgroundUrl: game.backgroundUrl,
      image: imageOf(game),
      publishedAt: game.publishedAt,
      objects: sorted(objects).map(forMasterOf),
    };
  }

  if (status === "draft" || status === "scheduled") return null;

  const image = imageOf(game);
  if (image === null) {
    throw new Error(`Game ${game.id} is ${status} but has no generated image`);
  }

  if (status === "active") {
    return { ...base, viewer: "player", status, image, objects: sorted(objects).map(thumbnailOf) };
  }

  return { ...base, viewer: "player", status, image, objects: sorted(objects).map(revealOf) };
}
