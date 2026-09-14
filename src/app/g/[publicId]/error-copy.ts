import type { ActionError } from "@/lib/games/result";

/**
 * `?error=` carries an `ActionError` *code*, never a message. The page turns a known code
 * into fixed copy here; anything else renders nothing, so a crafted link cannot put text
 * of its author's choosing into the app's alert styling.
 */
export type ErrorCopy = Readonly<Partial<Record<ActionError, string>>>;

const GENERIC = "Something went wrong. Try again.";

// A complete record, so adding a code to `ActionError` is a type error until it is listed here.
const CODES: Readonly<Record<ActionError, true>> = {
  UNAUTHENTICATED: true,
  NOT_FOUND: true,
  NOT_MASTER: true,
  INVALID_INPUT: true,
  NOT_DRAFT: true,
  NO_OBJECTS: true,
  TOO_MANY_OBJECTS: true,
  NO_IMAGE: true,
  UNCONFIRMED_OBJECTS: true,
  INVALID_WINDOW: true,
  NOT_ACTIVE: true,
  MASTER_CANNOT_PLAY: true,
  NOT_STARTED: true,
  ALREADY_SUBMITTED: true,
  WRONG_MARKER_COUNT: true,
  LEADERBOARD_HIDDEN: true,
};

export function isActionError(value: unknown): value is ActionError {
  return typeof value === "string" && Object.hasOwn(CODES, value);
}

/** Codes the Start action can emit (SPEC §3.3). */
export const PLAY_COPY: ErrorCopy = {
  NOT_ACTIVE: "This game is not open for play right now.",
  MASTER_CANNOT_PLAY: "The game master cannot play their own game.",
  UNAUTHENTICATED: "Sign in to start.",
};

/** Fixed copy for a known code (a generic line when the table has none); null for anything else. */
export function errorCopy(code: string | undefined, table: ErrorCopy = PLAY_COPY): string | null {
  if (!isActionError(code)) return null;
  return table[code] ?? GENERIC;
}
