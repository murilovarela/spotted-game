/** Pure input and precondition checks. No I/O. */
import { MAX_OBJECTS_PER_GAME, MIN_OBJECTS_PER_GAME } from "@/lib/types";
import { fail, ok, type ActionResult } from "./result";

const bounded = (value: string, min: number, max: number, what: string): ActionResult<string> => {
  // `value` is typed as `string`, but a server action's argument crosses a wire boundary
  // where TypeScript cannot enforce that — a caller that bypasses the type (or a
  // malformed client) can hand this a non-string at runtime.
  if (typeof value !== "string") return fail("INVALID_INPUT", `${what} must be a string`);
  const s = value.trim();
  if (s.length < min || s.length > max) {
    return fail("INVALID_INPUT", `${what} must be ${min}–${max} characters`);
  }
  return ok(s);
};

/**
 * `requestedScale` is a fraction of image width (SPEC §5.3): the DB CHECK is `> 0`, and
 * it can never exceed 1 like every other `Normalized` value.
 */
export function isValidScale(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1;
}

export const validateTitle = (s: string) => bounded(s, 1, 120, "Title");
export const validateLabel = (s: string) => bounded(s, 1, 60, "Label");
export const validatePrompt = (s: string) => bounded(s, 0, 500, "Prompt");

const isValidDate = (d: Date) => Number.isFinite(d.getTime());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 shape check, case-insensitive. Guards ids before they reach a uuid column. */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function validateWindow(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): ActionResult<{ startsAt: Date; endsAt: Date }> {
  if (!isValidDate(startsAt) || !isValidDate(endsAt)) return fail("INVALID_WINDOW", "Start and end must be valid dates");
  if (endsAt.getTime() <= startsAt.getTime()) return fail("INVALID_WINDOW", "End must be after start");
  if (startsAt.getTime() < now.getTime()) return fail("INVALID_WINDOW", "Start cannot be in the past");
  return ok({ startsAt, endsAt });
}

export type PublishGameSource = {
  readonly publishedAt: Date | null;
  readonly generatedImageKey: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};
export type PublishObjectSource = { readonly confirmed: boolean };

/** Invariant 4 lives here and is re-checked inside the publish transaction. */
export function publishPreconditions(
  game: PublishGameSource,
  objects: readonly PublishObjectSource[],
): ActionResult<null> {
  if (game.publishedAt !== null) return fail("NOT_DRAFT", "Game is already published");
  if (objects.length < MIN_OBJECTS_PER_GAME) return fail("NO_OBJECTS", "Add at least one object");
  if (objects.length > MAX_OBJECTS_PER_GAME) return fail("TOO_MANY_OBJECTS", `At most ${MAX_OBJECTS_PER_GAME} objects`);
  if (game.generatedImageKey === null) return fail("NO_IMAGE", "Generate the image first");
  const unconfirmed = objects.filter((o) => !o.confirmed).length;
  if (unconfirmed > 0) return fail("UNCONFIRMED_OBJECTS", `${unconfirmed} object(s) not confirmed`);
  if (game.startsAt === null || game.endsAt === null) return fail("INVALID_WINDOW", "Set the start and end");
  return ok(null);
}

export function validateMarkerCount(markerCount: number, objectCount: number): ActionResult<null> {
  if (markerCount !== objectCount) {
    return fail("WRONG_MARKER_COUNT", `Place exactly ${objectCount} marker(s); you placed ${markerCount}`);
  }
  return ok(null);
}
