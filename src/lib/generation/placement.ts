/** Deterministic, non-overlapping placement for paste mode. Pure. */
import type { ImageSize } from "@/lib/types";
import { overlapFraction } from "./boxes";
import { DEFAULT_SCALE } from "./prompt";
import type { Box } from "./types";

export type PlaceableObject = { readonly id: string; readonly requestedScale: number | null; /** sprite height / width */ readonly aspect: number };
export type PlacementOptions = {
  /** Kept clear on every side of the area, as a fraction of the area's own width/height. */
  readonly margin: number;
  readonly gap: number;
  readonly maxTries: number;
  /** Where boxes may land (normalized against the frame); default the whole frame. */
  readonly area?: Box;
};
const FULL_FRAME: Box = { x: 0, y: 0, w: 1, h: 1 };
// `gap` must exceed the diff's `mergeGap` (0.02) plus its dilation by a clear margin: two
// pasted objects closer than that are merged into one candidate region, and validation then
// reports both as a 100% overlap (seen in CI on a seed that placed them ~2% apart).
export const PLACEMENT_GAP = 0.06;
export const PLACEMENT_DEFAULTS: PlacementOptions = { margin: 0.1, gap: PLACEMENT_GAP, maxTries: 500 };

/** mulberry32 seeded from an FNV-1a hash of the string. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeObjects(objects: readonly PlaceableObject[], image: ImageSize, seed: string, opts: PlacementOptions = PLACEMENT_DEFAULTS): Box[] {
  const rand = seededRandom(seed);
  const area = opts.area ?? FULL_FRAME;
  const minX = area.x + opts.margin * area.w;
  const minY = area.y + opts.margin * area.h;
  const placed: Box[] = [];
  for (const o of objects) {
    const w = o.requestedScale ?? DEFAULT_SCALE;
    const h = (w * o.aspect * image.width) / image.height;
    const maxX = area.x + area.w - opts.margin * area.w - w;
    const maxY = area.y + area.h - opts.margin * area.h - h;
    let box: Box | null = null;
    for (let t = 0; t < opts.maxTries && maxX >= minX && maxY >= minY; t++) {
      const cand = { x: minX + rand() * (maxX - minX), y: minY + rand() * (maxY - minY), w, h };
      const padded = { x: cand.x - opts.gap, y: cand.y - opts.gap, w: w + 2 * opts.gap, h: h + 2 * opts.gap };
      if (placed.every((p) => overlapFraction(padded, p) === 0)) {
        box = cand;
        break;
      }
    }
    if (!box) throw new Error(`placement: could not place object ${o.id} without overlap`);
    placed.push(box);
  }
  return placed;
}
