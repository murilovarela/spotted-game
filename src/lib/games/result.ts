/**
 * Every server action returns one of these. Nothing throws across the action boundary,
 * so the UI can render a specific, actionable message (SPEC §8).
 */
export type ActionError =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "NOT_MASTER"
  | "INVALID_INPUT"
  | "NOT_DRAFT"
  | "NO_OBJECTS"
  | "TOO_MANY_OBJECTS"
  | "NO_IMAGE"
  | "UNCONFIRMED_OBJECTS"
  | "INVALID_WINDOW"
  | "NOT_ACTIVE"
  | "MASTER_CANNOT_PLAY"
  | "NOT_STARTED"
  | "ALREADY_SUBMITTED"
  | "WRONG_MARKER_COUNT"
  | "LEADERBOARD_HIDDEN";

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ActionError; readonly message: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: ActionError, message: string): ActionResult<never> => ({ ok: false, error, message });
