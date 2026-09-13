/**
 * Scoring is pure: data in, data out, no I/O. It runs server-side only; the
 * result is persisted to `attempts` / `markers` and the client receives
 * hit/miss counts, never object positions.
 */
import type { ImageSize, NormalizedCircle, NormalizedPoint } from "./types";

export type ScorableObject = NormalizedCircle & { readonly id: string };

export type ScoreInput = {
  readonly markers: readonly NormalizedPoint[];
  readonly objects: readonly ScorableObject[];
  /** Pixel size of the generated image; needed because x and y are normalized against different extents. */
  readonly image: ImageSize;
};

export type ScoreResult = {
  readonly foundCount: number;
  /** One entry per input marker, same order: the matched object id, or null for a miss. */
  readonly assignments: ReadonlyArray<string | null>;
};

/**
 * Squared distance between two points, in units of image width. x is already in
 * width units; y is normalized against height, so it is rescaled by height/width.
 * Comparing squared values avoids a sqrt and keeps the boundary exact.
 */
function squaredDistanceInWidthUnits(a: NormalizedPoint, b: NormalizedPoint, image: ImageSize): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * (image.height / image.width);
  return dx * dx + dy * dy;
}

type Candidate = {
  readonly markerIndex: number;
  readonly objectIndex: number;
  readonly distanceSq: number;
};

/**
 * Greedy nearest-match (SPEC §3.4, §6.6).
 *
 * Every (marker, object) pair within the object's radius is a candidate. Candidates are
 * taken closest-first; each marker and each object is consumed at most once. Because
 * only hits are candidates, a near miss never blocks another marker from scoring, and
 * because the ordering is global, the result does not depend on marker placement order —
 * except on an exact distance tie, where the lower marker index wins. Measure-zero with
 * doubles; noted so nobody "fixes" it into something order-dependent for real.
 */
export function scoreAttempt({ markers, objects, image }: ScoreInput): ScoreResult {
  const candidates: Candidate[] = [];
  markers.forEach((marker, markerIndex) => {
    objects.forEach((object, objectIndex) => {
      const distanceSq = squaredDistanceInWidthUnits(marker, object, image);
      // A hit is inclusive: a centre exactly on the radius counts.
      if (distanceSq <= object.radius * object.radius) {
        candidates.push({ markerIndex, objectIndex, distanceSq });
      }
    });
  });

  candidates.sort(
    (a, b) => a.distanceSq - b.distanceSq || a.markerIndex - b.markerIndex || a.objectIndex - b.objectIndex,
  );

  const assignments: Array<string | null> = markers.map(() => null);
  const consumedObjects = new Set<number>();
  let foundCount = 0;

  for (const { markerIndex, objectIndex } of candidates) {
    if (assignments[markerIndex] !== null || consumedObjects.has(objectIndex)) continue;
    assignments[markerIndex] = objects[objectIndex].id;
    consumedObjects.add(objectIndex);
    foundCount += 1;
  }

  return { foundCount, assignments };
}
