"use server";
/**
 * Thin wrappers: resolve the user, call core, revalidate. No logic here.
 * Canvas (Phase 3) and the master pages call these; nothing else is exported to the client.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isNormalized, type AttemptResult, type LeaderboardEntry, type NormalizedPoint, type PlayerAttemptState } from "@/lib/types";
import * as core from "./games";
import * as play from "./play";
import { fail, type ActionResult } from "./result";
import { isValidScale } from "./validation";

// Hand-copied input shapes here would drift from core's real signatures (jscpd flagged the
// duplication); these are derived from the functions they call instead. A "use server" file
// may only export async functions, so these stay unexported.
type CreateGameInput = Parameters<typeof core.createGame>[2];
type UpdateGameInput = Parameters<typeof core.updateGame>[3];
type AddObjectInput = Parameters<typeof core.addObject>[3];
type UpdateObjectInput = Parameters<typeof core.updateObject>[3];
type SetWindowInput = Parameters<typeof core.setWindow>[3];

async function withUser<T>(fn: (user: User) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  return fn(user);
}

function touched(gameId: string): void {
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
}

/**
 * Marker points arrive from the client as plain `{x, y}` numbers — the `Normalized`
 * brand is a compile-time fiction across the wire. Validate at runtime before handing
 * them to core.
 */
function toNormalizedPoints(points: ReadonlyArray<unknown>): NormalizedPoint[] | null {
  const result: NormalizedPoint[] = [];
  for (const p of points) {
    if (typeof p !== "object" || p === null) return null;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || !isNormalized(x)) return null;
    if (typeof y !== "number" || !isNormalized(y)) return null;
    result.push({ x, y });
  }
  return result;
}

/**
 * `x`/`y`/`radius`/`requestedScale` arrive from the client as plain numbers — the branded
 * types are a compile-time fiction across the wire (same reasoning as `toNormalizedPoints`).
 * Nothing may throw across the action boundary, so this returns a failure instead.
 */
function validatePositionalInput(input: {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly radius?: unknown;
  readonly requestedScale?: unknown;
}): ActionResult<null> {
  for (const [key, value] of [
    ["x", input.x],
    ["y", input.y],
    ["radius", input.radius],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !isNormalized(value)) {
      return fail("INVALID_INPUT", `${key} must be a number in [0, 1]`);
    }
  }
  if (input.requestedScale !== undefined && input.requestedScale !== null && !isValidScale(input.requestedScale)) {
    return fail("INVALID_INPUT", "requestedScale must be a number in (0, 1]");
  }
  return { ok: true, data: null };
}

// --- authoring (called by the master pages) ---

export async function createGameAction(input: CreateGameInput): Promise<ActionResult<{ id: string; publicId: string }>> {
  return withUser(async (u) => {
    const r = await core.createGame(getDb(), u, input);
    if (r.ok) revalidatePath("/games");
    return r;
  });
}

export async function updateGameAction(gameId: string, input: UpdateGameInput): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.updateGame(getDb(), u, gameId, input);
    touched(gameId);
    return r;
  });
}

export async function deleteGameAction(gameId: string): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.deleteGame(getDb(), u, gameId);
    touched(gameId);
    return r;
  });
}

export async function addObjectAction(gameId: string, input: AddObjectInput): Promise<ActionResult<{ id: string }>> {
  const v = validatePositionalInput(input);
  if (!v.ok) return v;
  return withUser(async (u) => {
    const r = await core.addObject(getDb(), u, gameId, input);
    touched(gameId);
    return r;
  });
}

export async function updateObjectAction(gameId: string, objectId: string, input: UpdateObjectInput): Promise<ActionResult<null>> {
  const v = validatePositionalInput(input);
  if (!v.ok) return v;
  return withUser(async (u) => {
    const r = await core.updateObject(getDb(), u, objectId, input);
    touched(gameId);
    return r;
  });
}

export async function confirmObjectAction(gameId: string, objectId: string): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.confirmObject(getDb(), u, objectId);
    touched(gameId);
    return r;
  });
}

export async function removeObjectAction(gameId: string, objectId: string): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.removeObject(getDb(), u, objectId);
    touched(gameId);
    return r;
  });
}

export async function setWindowAction(gameId: string, input: SetWindowInput): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.setWindow(getDb(), u, gameId, input, new Date());
    touched(gameId);
    return r;
  });
}

export async function publishGameAction(gameId: string): Promise<ActionResult<{ publishedAt: Date }>> {
  return withUser(async (u) => {
    const r = await core.publishGame(getDb(), u, gameId, new Date());
    touched(gameId);
    return r;
  });
}

export async function unpublishGameAction(gameId: string): Promise<ActionResult<null>> {
  return withUser(async (u) => {
    const r = await core.unpublishGame(getDb(), u, gameId, new Date());
    touched(gameId);
    return r;
  });
}

// --- play (called by the Phase 3 play surface) ---

export async function startAttemptAction(publicId: string): Promise<ActionResult<{ startedAt: Date }>> {
  return withUser((u) => play.startAttempt(getDb(), u, publicId, new Date()));
}

export async function submitAttemptAction(
  publicId: string,
  points: ReadonlyArray<{ x: number; y: number }>,
): Promise<ActionResult<AttemptResult>> {
  if (!Array.isArray(points)) return fail("INVALID_INPUT", "Markers must be normalized coordinates");
  const normalizedPoints = toNormalizedPoints(points);
  if (normalizedPoints === null) return fail("INVALID_INPUT", "Markers must be normalized coordinates");
  return withUser((u) => play.submitAttempt(getDb(), u, publicId, normalizedPoints, new Date()));
}

export async function getPlayerStateAction(publicId: string): Promise<ActionResult<PlayerAttemptState>> {
  return withUser((u) => play.getPlayerState(getDb(), u, publicId));
}

export async function getLeaderboardAction(publicId: string): Promise<ActionResult<LeaderboardEntry[]>> {
  return play.getLeaderboard(getDb(), await getCurrentUser(), publicId, new Date());
}
