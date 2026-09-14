/** One attempt of the SPEC §5.3 pipeline, given a backend. Shared by run.ts and the eval. */
import type { GenerationBackend } from "./backend";
import { DIFF_DEFAULTS, diffRegions } from "./diff";
import { cropPng, diffScale, downscale, letterboxTo, toRGBAAt } from "./images";
import { adjustmentFor, composePrompt, mergeAdjustments } from "./prompt";
import { type Adjustment, type Candidate, type ComposeResult, type GameInput, MAX_BACKGROUND_SIDE, MAX_CHANGED_FRACTION, MAX_OBJECT_SIDE, type ValidationResult, type VisionLabel } from "./types";
import { changedFraction, validate } from "./validate";

export type AttemptOutcome = {
  readonly prompt: string;
  readonly image: ComposeResult;
  readonly candidates: readonly Candidate[];
  readonly labels: readonly VisionLabel[];
  readonly visionRaw: unknown;
  readonly result: ValidationResult;
  /** Accumulated adjustments to use for the NEXT attempt (input ones + new ones). */
  readonly adjustments: readonly Adjustment[];
  /** Only the adjustments this attempt's failures added that were not already in the input. */
  readonly added: readonly Adjustment[];
};

/** The bytes the backend sees: bounded so an oversized upload never reaches the model as-is. */
async function boundInputs(game: GameInput): Promise<GameInput> {
  const [background, ...images] = await Promise.all([downscale(game.background, MAX_BACKGROUND_SIDE), ...game.objects.map((o) => downscale(o.image, MAX_OBJECT_SIDE))]);
  return { ...game, background, objects: game.objects.map((o, i) => ({ ...o, image: images[i] })) };
}

export async function attemptOnce(backend: GenerationBackend, game: GameInput, adjustments: readonly Adjustment[]): Promise<AttemptOutcome> {
  const prompt = composePrompt(game, game.objects, adjustments);
  const bounded = await boundInputs(game);
  const image = await backend.compose({ ...bounded, prompt });
  // The diff compares the generated image with the *original* background on one grid, so the
  // candidates — and every coordinate downstream — stay normalized against the generated image.
  // The background is letterboxed into that grid the way the model was asked to extend it; the
  // mask keeps the outpainted fill bands out of the comparison.
  const size = { width: image.width, height: image.height };
  const small = diffScale(size);
  const boxed = await letterboxTo(game.background, small);
  const [gen, bg] = await Promise.all([toRGBAAt(image.png, small), toRGBAAt(boxed.png, small)]);
  const candidates = diffRegions(bg, gen, small.width, small.height, { ...DIFF_DEFAULTS, maxCandidates: 2 * game.objects.length }, boxed.mask);

  // Vision is only worth calling when there is something to label and the background survived:
  // with nothing changed every object is `absent`, and with most of the frame changed `validate`
  // reports `background_altered` regardless of what the labels would have said.
  let labels: readonly VisionLabel[] = [];
  let visionRaw: unknown = null;
  if (candidates.length > 0 && changedFraction(candidates) <= MAX_CHANGED_FRACTION) {
    const crops = await Promise.all(candidates.map((c) => cropPng(image.png, c, size)));
    ({ labels, raw: visionRaw } = await backend.label({ game: bounded, scene: image, candidates, crops }));
  }

  const result = validate(game.objects, candidates, labels, size);
  const candidatesNew = result.ok
    ? []
    : result.failures.flatMap((f) => {
        const a = adjustmentFor(f, game.objects.find((o) => o.id === f.objectId) ?? null);
        return a ? [a] : [];
      });
  // `added` holds only what this attempt contributed beyond the input: a repeated identical
  // failure adds nothing, and the run row records adjustment = null for it.
  const merged = mergeAdjustments(adjustments, candidatesNew);
  const added = merged.slice(adjustments.length);
  return { prompt, image, candidates, labels, visionRaw, result, adjustments: merged, added };
}
