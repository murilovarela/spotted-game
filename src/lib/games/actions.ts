"use server";
/**
 * Thin wrappers: resolve the user, call core, revalidate. No logic here.
 * Canvas (Phase 3) and the master pages call these; nothing else is exported to the client.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isNormalized, type AttemptResult, type LeaderboardEntry, type Normalized, type NormalizedPoint, type PlayerAttemptState } from "@/lib/types";
import * as core from "./games";
import * as play from "./play";
import { fail, type ActionResult } from "./result";

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
function toNormalizedPoints(points: ReadonlyArray<{ x: number; y: number }>): NormalizedPoint[] | null {
  const result: NormalizedPoint[] = [];
  for (const p of points) {
    if (!isNormalized(p.x)) return null;
    if (!isNormalized(p.y)) return null;
    result.push({ x: p.x, y: p.y });
  }
  return result;
}

// --- authoring (called by the master pages) ---

export async function createGameAction(input: { title: string; generalPrompt: string }): Promise<ActionResult<{ id: string; publicId: string }>> {
  return withUser(async (u) => {
    const r = await core.createGame(getDb(), u, input);
    if (r.ok) revalidatePath("/games");
    return r;
  });
}

export async function updateGameAction(
  gameId: string,
  input: { title?: string; generalPrompt?: string; backgroundKey?: string },
): Promise<ActionResult<null>> {
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

export async function addObjectAction(
  gameId: string,
  input: { label: string; prompt: string; sourceImageKey: string; requestedScale?: Normalized },
): Promise<ActionResult<{ id: string }>> {
  return withUser(async (u) => {
    const r = await core.addObject(getDb(), u, gameId, input);
    touched(gameId);
    return r;
  });
}

export async function updateObjectAction(
  gameId: string,
  objectId: string,
  input: {
    label?: string;
    prompt?: string;
    sourceImageKey?: string;
    requestedScale?: Normalized | null;
    x?: Normalized;
    y?: Normalized;
    radius?: Normalized;
  },
): Promise<ActionResult<null>> {
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

export async function setWindowAction(gameId: string, input: { startsAt: Date; endsAt: Date }): Promise<ActionResult<null>> {
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
  return withUser((u) => play.getPlayerState(getDb(), u, publicId, new Date()));
}

export async function getLeaderboardAction(publicId: string): Promise<ActionResult<LeaderboardEntry[]>> {
  return play.getLeaderboard(getDb(), await getCurrentUser(), publicId, new Date());
}
