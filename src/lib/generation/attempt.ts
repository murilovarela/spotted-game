/** One attempt of the SPEC §5.3 pipeline, given a backend. Shared by run.ts and the eval. */
import type { GenerationBackend } from "./backend";
import { DIFF_DEFAULTS, diffRegions } from "./diff";
import { cropPng, diffScale, toRGBAAt } from "./images";
import { adjustmentFor, composePrompt, mergeAdjustments } from "./prompt";
import type { Adjustment, Candidate, ComposeResult, GameInput, ValidationResult, VisionLabel } from "./types";
import { validate } from "./validate";

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

export async function attemptOnce(backend: GenerationBackend, game: GameInput, adjustments: readonly Adjustment[]): Promise<AttemptOutcome> {
  const prompt = composePrompt(game, game.objects, adjustments);
  const image = await backend.compose({ ...game, prompt });
  const size = { width: image.width, height: image.height };
  const small = diffScale(size);
  const [gen, bg] = await Promise.all([toRGBAAt(image.png, small), toRGBAAt(game.background, small)]);
  const candidates = diffRegions(bg, gen, small.width, small.height, { ...DIFF_DEFAULTS, maxCandidates: 2 * game.objects.length });

  let labels: readonly VisionLabel[] = [];
  let visionRaw: unknown = null;
  if (candidates.length > 0) {
    const crops = await Promise.all(candidates.map((c) => cropPng(image.png, c, size)));
    ({ labels, raw: visionRaw } = await backend.label({ game, scene: image, candidates, crops }));
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
