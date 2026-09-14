/**
 * SPEC §5.3 validation predicate. Pure: candidates + vision labels in, proposals or
 * failures out. Per object the checks run in SPEC order and the first failure wins;
 * overlap is checked last, pairwise, among objects that passed their own checks. Before
 * any of that: if the changed regions cover most of the frame the background itself was
 * re-rendered, and that single scene-level failure replaces the per-object ones.
 */
import type { ImageSize } from "@/lib/types";
import { insideMargin, overlapFraction, scaleRatio, toCircle } from "./boxes";
import { CONFIDENCE_THRESHOLD, FRAME_MARGIN, MAX_CHANGED_FRACTION, MAX_OVERLAP, SCALE_TOLERANCE, type Box, type Candidate, type Failure, type ValidationResult, type VisionLabel } from "./types";

export type ValidatableObject = { readonly id: string; readonly label: string; readonly requestedScale: number | null };

/** Fraction of the frame covered by candidates (boxes are already merged, so the sum is the cover). */
export function changedFraction(candidates: readonly Candidate[]): number {
  return candidates.reduce((sum, c) => sum + c.area, 0);
}

export function validate(
  objects: readonly ValidatableObject[],
  candidates: readonly Candidate[],
  labels: readonly VisionLabel[],
  image: ImageSize,
): ValidationResult {
  const changed = changedFraction(candidates);
  if (changed > MAX_CHANGED_FRACTION) {
    const pct = Math.round(changed * 100);
    return { ok: false, failures: [{ objectId: null, class: "background_altered", detail: `changed regions cover ${pct}% of the frame; the background was re-rendered` }] };
  }

  const failures: Failure[] = [];
  const matched = new Map<string, Box>();
  const known = new Set(objects.map((o) => o.id));

  // Best label per object; labels for unknown candidates/objects are noise from the model.
  const best = new Map<string, VisionLabel>();
  for (const l of labels) {
    if (l.objectId === null || !known.has(l.objectId) || !candidates[l.candidate]) continue;
    const prev = best.get(l.objectId);
    if (!prev || l.confidence > prev.confidence) best.set(l.objectId, l);
  }

  for (const o of objects) {
    const l = best.get(o.id);
    if (!l) {
      failures.push({ objectId: o.id, class: "absent", detail: "no changed region was labelled as this object" });
      continue;
    }
    if (l.confidence < CONFIDENCE_THRESHOLD) {
      failures.push({ objectId: o.id, class: "low_confidence", detail: `confidence ${l.confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}` });
      continue;
    }
    const box = candidates[l.candidate];
    if (!insideMargin(box, FRAME_MARGIN)) {
      failures.push({ objectId: o.id, class: "out_of_bounds", detail: `box crosses the outer ${FRAME_MARGIN * 100}% margin` });
      continue;
    }
    if (o.requestedScale !== null) {
      const ratio = scaleRatio(box, o.requestedScale, image);
      if (ratio > SCALE_TOLERANCE || ratio < 1 / SCALE_TOLERANCE) {
        failures.push({ objectId: o.id, class: "scale", detail: `box area is ${ratio.toFixed(1)}× the requested scale` });
        continue;
      }
    }
    matched.set(o.id, box);
  }

  const passed = objects.filter((o) => matched.has(o.id));
  const overlapped = new Set<string>();
  for (let i = 0; i < passed.length; i++) {
    for (let j = i + 1; j < passed.length; j++) {
      const a = passed[i];
      const b = passed[j];
      const f = overlapFraction(matched.get(a.id) as Box, matched.get(b.id) as Box);
      if (f <= MAX_OVERLAP) continue;
      const pct = `${Math.round(f * 100)}%`;
      if (!overlapped.has(a.id)) failures.push({ objectId: a.id, class: "overlap", detail: `${a.label} overlaps ${b.label} by ${pct}` });
      if (!overlapped.has(b.id)) failures.push({ objectId: b.id, class: "overlap", detail: `${b.label} overlaps ${a.label} by ${pct}` });
      overlapped.add(a.id).add(b.id);
    }
  }

  if (failures.length > 0) {
    const order = new Map(objects.map((o, i) => [o.id, i]));
    failures.sort((p, q) => (order.get(p.objectId ?? "") ?? 0) - (order.get(q.objectId ?? "") ?? 0));
    return { ok: false, failures };
  }
  return { ok: true, proposals: objects.map((o) => ({ objectId: o.id, ...toCircle(matched.get(o.id) as Box, image) })) };
}
