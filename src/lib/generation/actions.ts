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
import { runGeneration, startGeneration } from "./run";

export async function startGenerationAction(gameId: string): Promise<ActionResult<{ attemptNumber: number }>> {
  if (!isUuid(gameId)) return fail("NOT_FOUND", "Game not found");
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  const started = await startGeneration(getDb(), user, gameId, new Date());
  if (!started.ok) return started;
  after(async () => {
    await runGeneration(getDb(), gameId, started.data.runId, backendFromEnv(), { now: () => new Date(), getObject, putObject });
    revalidatePath(`/games/${gameId}`);
  });
  revalidatePath(`/games/${gameId}`);
  return ok({ attemptNumber: started.data.attemptNumber });
}
