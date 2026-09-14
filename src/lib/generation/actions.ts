"use server";
/** Trigger for the generation loop. The loop itself runs after the response via `after()`. */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/games/result";
import { isUuid } from "@/lib/games/validation";
import { getObject, putObject } from "@/lib/storage";
import { backendFromEnv } from "./backend";
import { dailyCapFromEnv, runGeneration, startGeneration } from "./run";

export async function startGenerationAction(gameId: string): Promise<ActionResult<{ attemptNumber: number }>> {
  if (!isUuid(gameId)) return fail("NOT_FOUND", "Game not found");
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  const started = await startGeneration(getDb(), user, gameId, new Date(), { dailyCap: dailyCapFromEnv() });
  if (!started.ok) return started;
  after(async () => {
    try {
      await runGeneration(getDb(), gameId, started.data.runId, backendFromEnv(), { now: () => new Date(), getObject, putObject });
    } catch (error: unknown) {
      // The loop finalizes its own row on every path; this catches only failures outside it
      // (e.g. the finalizing write itself), so the host logs show why a row went stale.
      console.error("generation loop failed", { gameId, error });
    }
    revalidatePath(`/games/${gameId}`);
  });
  revalidatePath(`/games/${gameId}`);
  return ok({ attemptNumber: started.data.attemptNumber });
}
