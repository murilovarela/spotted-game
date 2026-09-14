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

  // Labelling is only worth a call when there is something to label and the background survived:
  // with nothing changed every object is `absent`, and with most of the frame changed the diff
  // regions say nothing about where the objects are.
  const diffCover = changedFraction(candidates);
  const diffUsable = diffCover <= MAX_CHANGED_FRACTION;
  let labels: readonly VisionLabel[] = [];
  let labelRaw: unknown = null;
  if (candidates.length > 0 && diffUsable) {
    const crops = await Promise.all(candidates.map((c) => cropPng(image.png, c, size)));
    ({ labels, raw: labelRaw } = await backend.label({ game: bounded, scene: image, candidates, crops }));
  }

  // Fallback: objects the diff could not see (all of them when it was unusable) are put to the
  // vision model directly. Its boxes join the candidates as `source: "vision"` with a synthetic
  // label, and go through the same validation; the master still confirms by dragging (SPEC §5.4).
  const labelled = new Set(labels.filter((l) => l.objectId !== null && candidates[l.candidate]).map((l) => l.objectId));
  const unresolved = diffUsable ? bounded.objects.filter((o) => !labelled.has(o.id)) : bounded.objects;
  let locateRaw: unknown = null;
  const located: Candidate[] = [];
  const locatedLabels: VisionLabel[] = [];
  if (unresolved.length > 0 && backend.locate) {
    const { boxes, raw } = await backend.locate({ scene: image, objects: unresolved });
    locateRaw = raw;
    const asked = new Set(unresolved.map((o) => o.id));
    for (const l of boxes) {
      if (!asked.has(l.objectId)) continue;
      locatedLabels.push({ candidate: candidates.length + located.length, objectId: l.objectId, confidence: l.confidence });
      located.push({ ...l.box, area: l.box.w * l.box.h, source: "vision" });
    }
  }
  const allCandidates = [...candidates, ...located];
  const allLabels = [...labels, ...locatedLabels];
  const visionRaw: unknown = { diffCover, labels: labelRaw, locate: locateRaw };

  const result = validate(game.objects, allCandidates, allLabels, size);
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
  return { prompt, image, candidates: allCandidates, labels: allLabels, visionRaw, result, adjustments: merged, added };
}
