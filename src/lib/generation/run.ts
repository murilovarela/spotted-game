/**
 * The generation loop (SPEC §5.3). Every attempt is a generation_runs row that exists
 * before the backend is called and is finalized on every path, thrown errors included —
 * this table is the project's autonomous-loop evidence.
 */
import { and, asc, eq, max } from "drizzle-orm";
import type { Database } from "@/db";
import { games, generationRuns, objects, type User } from "@/db/schema";
import { setGeneratedImage } from "@/lib/games/games";
import { fail, ok, type ActionResult } from "@/lib/games/result";
import { objectKey } from "@/lib/storage";
import { MAX_GENERATION_ATTEMPTS } from "@/lib/types";
import { attemptOnce } from "./attempt";
import type { BackendSelection } from "./backend";
import { frameGeometry } from "./boxes";
import { dimensions } from "./images";
import { composePrompt, formatAdjustments, formatFailures } from "./prompt";
import { deriveGenerationState } from "./status";
import type { Adjustment, GameInput } from "./types";

export type RunDeps = {
  now(): Date;
  getObject(key: string): Promise<Uint8Array>;
  putObject(key: string, contentType: string, body: Uint8Array): Promise<void>;
};

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function objectRows(db: Database | Tx, gameId: string) {
  return db.select().from(objects).where(eq(objects.gameId, gameId)).orderBy(asc(objects.sortOrder));
}

/** Owner + draft + inputs present + no live run; inserts the first attempt row under the game lock. */
export async function startGeneration(
  db: Database,
  user: User,
  gameId: string,
  now: Date,
): Promise<ActionResult<{ runId: string; attemptNumber: number }>> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
    if (!game || game.masterId !== user.id) return fail("NOT_FOUND", "Game not found");
    if (game.publishedAt !== null) return fail("NOT_DRAFT", "Only a draft can be generated");
    if (game.backgroundKey === null) return fail("INVALID_INPUT", "Upload a background first");
    const objs = await objectRows(tx, gameId);
    if (objs.length === 0) return fail("NO_OBJECTS", "Add at least one object");
    const runs = await tx.select().from(generationRuns).where(eq(generationRuns.gameId, gameId));
    if (deriveGenerationState(runs, now).kind === "running") return fail("INVALID_INPUT", "A generation is already running");
    const attemptNumber = runs.reduce((m, r) => Math.max(m, r.attemptNumber), 0) + 1;
    const [row] = await tx
      .insert(generationRuns)
      .values({ gameId, attemptNumber, status: "queued", promptUsed: composePrompt(game, objs, []), startedAt: now })
      .returning({ id: generationRuns.id });
    return ok({ runId: row.id, attemptNumber });
  });
}

/** The loop's input plus what the prompt needs to know about the frame (`hasVoids`: letterbox bands to fill). */
type LoadedGame = GameInput & { readonly hasVoids: boolean };

async function loadGameInput(db: Database, gameId: string, deps: RunDeps): Promise<LoadedGame | null> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.backgroundKey === null) return null;
  const objs = await objectRows(db, gameId);
  const [background, ...images] = await Promise.all([deps.getObject(game.backgroundKey), ...objs.map((o) => deps.getObject(o.sourceImageKey))]);
  return {
    id: game.id,
    title: game.title,
    generalPrompt: game.generalPrompt,
    background,
    objects: objs.map((o, i) => ({ id: o.id, label: o.label, prompt: o.prompt, requestedScale: o.requestedScale, sortOrder: o.sortOrder, image: images[i] })),
    hasVoids: frameGeometry(await dimensions(background)).hasVoids,
  };
}

type Finish = {
  status: "passed" | "failed";
  failureReason?: string | null;
  adjustment?: string | null;
  visionResponse?: unknown;
  /** Exactly what was sent to the backend; omitted when the attempt never reached it. */
  promptUsed?: string;
};

async function finish(db: Database, runId: string, startedAt: Date, deps: RunDeps, f: Finish): Promise<void> {
  const now = deps.now();
  await db
    .update(generationRuns)
    .set({
      status: f.status,
      failureReason: f.failureReason ?? null,
      adjustment: f.adjustment ?? null,
      visionResponse: f.visionResponse ?? null,
      ...(f.promptUsed === undefined ? {} : { promptUsed: f.promptUsed }),
      finishedAt: now,
      durationMs: now.getTime() - startedAt.getTime(),
    })
    .where(eq(generationRuns.id, runId));
}

export async function runGeneration(db: Database, gameId: string, firstRunId: string, selection: BackendSelection, deps: RunDeps): Promise<void> {
  let runId = firstRunId;
  let startedAt = deps.now();
  // Only a queued row may start a loop: a late or duplicate `after()` must not run a second one.
  const claimed = await db
    .update(generationRuns)
    .set({ status: "running", startedAt })
    .where(and(eq(generationRuns.id, runId), eq(generationRuns.status, "queued")))
    .returning({ id: generationRuns.id });
  if (claimed.length === 0) return;

  if (!selection.ok) {
    await finish(db, runId, startedAt, deps, { status: "failed", failureReason: selection.reason });
    return;
  }
  let loadError = "game or background missing";
  const input = await loadGameInput(db, gameId, deps).catch((e: unknown) => {
    loadError = e instanceof Error ? e.message : String(e);
    return null;
  });
  if (!input) {
    await finish(db, runId, startedAt, deps, { status: "failed", failureReason: `error: could not load the game's images (${loadError})` });
    return;
  }
  // The queued row was composed before the background's shape was known; make it the prompt
  // that will actually be sent, so a thrown attempt never leaves a prompt that never went out.
  await db.update(generationRuns).set({ promptUsed: composePrompt(input, input.objects, []) }).where(eq(generationRuns.id, runId));

  let adjustments: readonly Adjustment[] = [];
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const [{ n }] = await db.select({ n: max(generationRuns.attemptNumber) }).from(generationRuns).where(eq(generationRuns.gameId, gameId));
      startedAt = deps.now();
      const [row] = await db
        .insert(generationRuns)
        .values({ gameId, attemptNumber: (n ?? 0) + 1, status: "running", promptUsed: composePrompt(input, input.objects, adjustments), startedAt })
        .returning({ id: generationRuns.id });
      runId = row.id;
    }
    try {
      const outcome = await attemptOnce(selection.backend, input, adjustments);
      const imageKey = objectKey("generated", gameId, "image/png");
      await deps.putObject(imageKey, "image/png", outcome.image.png);
      const evidence = { imageKey, width: outcome.image.width, height: outcome.image.height, candidates: outcome.candidates, labels: outcome.labels, raw: outcome.visionRaw };
      if (outcome.result.ok) {
        const set = await setGeneratedImage(db, gameId, { key: imageKey, width: outcome.image.width, height: outcome.image.height }, outcome.result.proposals);
        if (!set.ok) {
          await finish(db, runId, startedAt, deps, { status: "failed", failureReason: `error: ${set.message}`, visionResponse: evidence, promptUsed: outcome.prompt });
          return;
        }
        await finish(db, runId, startedAt, deps, { status: "passed", visionResponse: evidence, promptUsed: outcome.prompt });
        return;
      }
      // Image-pipeline non-negotiable: "a blind retry is not a recovery loop". A failure that
      // adds no new adjustment would send the exact same prompt again, so the loop stops here
      // and says so on the row; the attempt cap above only bounds runs whose prompt keeps changing.
      const stalled = outcome.added.length === 0;
      let failureReason = formatFailures(outcome.result.failures, input.objects);
      if (stalled) failureReason += "\nno new adjustment; not retrying";
      await finish(db, runId, startedAt, deps, {
        status: "failed",
        failureReason,
        adjustment: formatAdjustments(outcome.added),
        visionResponse: evidence,
        promptUsed: outcome.prompt,
      });
      if (stalled) return;
      adjustments = outcome.adjustments;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      await finish(db, runId, startedAt, deps, { status: "failed", failureReason: `error: ${message}` });
      return; // an exception is not a prompt problem; retrying blindly would violate §5.3
    }
  }
}
