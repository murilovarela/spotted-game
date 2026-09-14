/** One attempt of the SPEC §5.3 pipeline, given a backend. Shared by run.ts and the eval. */
import type { GenerationBackend } from "./backend";
import { DIFF_DEFAULTS, diffRegions } from "./diff";
import { frameGeometry } from "./boxes";
import { cropPng, diffScale, dimensions, downscale, letterboxTo, toRGBAAt } from "./images";
import { adjustmentFor, composePrompt, mergeAdjustments } from "./prompt";
import { type Adjustment, type Box, type Candidate, type ComposeResult, DIFF_BLUR_SIGMA, type GameInput, MAX_BACKGROUND_SIDE, MAX_CHANGED_FRACTION, MAX_OBJECT_SIDE, type ValidationResult, type VisionLabel } from "./types";
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

/**
 * The bytes the backend sees. The background is letterboxed into the output frame first, so
 * the model gets the same 4:3 canvas the diff will compare against and is told to fill the
 * bands rather than re-compose the photo; then everything is bounded so an oversized upload
 * never reaches the model as-is. `content` is where the real photo lies in that canvas.
 */
async function boundInputs(game: GameInput): Promise<{ input: GameInput; content: Box; hasVoids: boolean }> {
  const { frame, content, hasVoids } = frameGeometry(await dimensions(game.background));
  const boxed = await letterboxTo(game.background, frame);
  const [background, ...images] = await Promise.all([downscale(boxed.png, MAX_BACKGROUND_SIDE), ...game.objects.map((o) => downscale(o.image, MAX_OBJECT_SIDE))]);
  return { input: { ...game, background, objects: game.objects.map((o, i) => ({ ...o, image: images[i] })) }, content, hasVoids };
}

export async function attemptOnce(backend: GenerationBackend, game: GameInput, adjustments: readonly Adjustment[]): Promise<AttemptOutcome> {
  const { input: bounded, content, hasVoids } = await boundInputs(game);
  const prompt = composePrompt({ ...game, hasVoids }, game.objects, adjustments);
  const image = await backend.compose({ ...bounded, prompt, content });
  // The diff compares the generated image with the *original* background on one grid, so the
  // candidates — and every coordinate downstream — stay normalized against the generated image.
  // The background is letterboxed into that grid the way the model was given it; the mask keeps
  // the fill bands out of the comparison.
  const size = { width: image.width, height: image.height };
  const small = diffScale(size);
  // The mask is inset by the blur's reach so fill bleeding into the edge is not a change either.
  const boxed = await letterboxTo(game.background, small, Math.ceil(2 * DIFF_BLUR_SIGMA));
  const [gen, bg] = await Promise.all([toRGBAAt(image.png, small, DIFF_BLUR_SIGMA), toRGBAAt(boxed.png, small, DIFF_BLUR_SIGMA)]);
  const candidates = diffRegions(bg, gen, small.width, small.height, { ...DIFF_DEFAULTS, maxCandidates: 2 * game.objects.length }, boxed.mask);
  // Cover is judged against the real content, not the frame: a re-rendered portrait photo is
  // re-rendered even when its bands make it a minority of the frame.
  // With no comparable pixels at all (a tiny upload the inset swallows) the diff is unusable, explicitly.
  const contentFraction = boxed.mask.reduce((n, v) => n + v, 0) / boxed.mask.length;

  // Labelling is only worth a call when there is something to label and the background survived:
  // with nothing changed every object is `absent`, and with most of the frame changed the diff
  // regions say nothing about where the objects are.
  const diffCover = changedFraction(candidates, contentFraction);
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
  const visionRaw: unknown = { diffCover, contentFraction, labels: labelRaw, locate: locateRaw };

  const result = validate(game.objects, allCandidates, allLabels, size, contentFraction);
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
