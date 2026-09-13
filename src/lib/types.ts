/**
 * Shared contract between the platform, imagegen, and canvas streams.
 * Changing anything here affects all three — flag it, don't change it unilaterally.
 */

declare const normalizedBrand: unique symbol;

/**
 * A number in [0, 1], relative to the *generated* image (never the uploaded
 * background, never pixels). x is a fraction of image width, y of image height,
 * radius of image width. Construct via `normalized()`; never cast.
 */
export type Normalized = number & { readonly [normalizedBrand]: true };

export type NormalizedPoint = {
  readonly x: Normalized;
  readonly y: Normalized;
};

/** Object position as confirmed by the game master. */
export type NormalizedCircle = NormalizedPoint & {
  /** Fraction of image width. */
  readonly radius: Normalized;
};

export function isNormalized(n: number): n is Normalized {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Validating constructor. Throws on anything outside [0, 1] or non-finite. */
export function normalized(n: number): Normalized {
  if (!isNormalized(n)) {
    throw new RangeError(`Expected a value in [0, 1], got ${n}`);
  }
  return n;
}

/** Convert a pixel coordinate on the generated image to a normalized one. */
export function normalizePixel(px: number, extent: number): Normalized {
  if (extent <= 0) throw new RangeError(`Extent must be positive, got ${extent}`);
  return normalized(px / extent);
}

/** Pixel dimensions of the generated image. Needed to compare distances correctly on non-square images. */
export type ImageSize = {
  readonly width: number;
  readonly height: number;
};

/** Derived on read from starts_at / ends_at / published_at. Never stored. */
export const GAME_STATUSES = ["draft", "scheduled", "active", "finished"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const GENERATION_RUN_STATUSES = ["queued", "running", "passed", "failed"] as const;
export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number];

export const MAX_OBJECTS_PER_GAME = 5;
export const MIN_OBJECTS_PER_GAME = 1;
export const PUBLIC_ID_LENGTH = 21;
export const MAX_GENERATION_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Client-facing views. Produced only by `projectGame` in src/lib/visibility.ts.
// The shape of each view is the enforcement of invariant 1: a view for an
// active game has no field that could carry a coordinate.
// ---------------------------------------------------------------------------

export type Viewer = "master" | "player";

export type GameImage = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
};

/** What a player sees of an object during play: enough to know what to look for. */
export type ObjectThumbnail = {
  readonly id: string;
  readonly label: string;
  readonly sourceImageUrl: string;
  readonly sortOrder: number;
};

/** An object with its confirmed position, shown once answers are visible. */
export type ObjectReveal = ObjectThumbnail & NormalizedCircle;

/** The master's view: position may be absent before generation, and confirmation state matters. */
export type ObjectForMaster = ObjectThumbnail & {
  readonly prompt: string;
  readonly x: Normalized | null;
  readonly y: Normalized | null;
  readonly radius: Normalized | null;
  readonly confirmed: boolean;
};

type GameViewBase = {
  readonly publicId: string;
  readonly title: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};

export type ActiveGameView = GameViewBase & {
  readonly viewer: "player";
  readonly status: "active";
  readonly image: GameImage;
  readonly objects: readonly ObjectThumbnail[];
};

export type FinishedGameView = GameViewBase & {
  readonly viewer: "player";
  readonly status: "finished";
  readonly image: GameImage;
  readonly objects: readonly ObjectReveal[];
};

export type MasterGameView = GameViewBase & {
  readonly viewer: "master";
  readonly status: GameStatus;
  readonly id: string;
  readonly generalPrompt: string;
  readonly backgroundUrl: string | null;
  readonly image: GameImage | null;
  readonly publishedAt: Date | null;
  readonly objects: readonly ObjectForMaster[];
};

export type PlayerGameView = ActiveGameView | FinishedGameView;
export type GameView = PlayerGameView | MasterGameView;
