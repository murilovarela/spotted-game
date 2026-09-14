/** Deterministic, non-overlapping placement for paste mode. Pure. */
import type { ImageSize } from "@/lib/types";
import { overlapFraction } from "./boxes";
import { DEFAULT_SCALE } from "./prompt";
import type { Box } from "./types";

export type PlaceableObject = { readonly id: string; readonly requestedScale: number | null; /** sprite height / width */ readonly aspect: number };
export type PlacementOptions = { readonly margin: number; readonly gap: number; readonly maxTries: number };
const PLACEMENT_DEFAULTS: PlacementOptions = { margin: 0.1, gap: 0.02, maxTries: 500 };

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
  const placed: Box[] = [];
  for (const o of objects) {
    const w = o.requestedScale ?? DEFAULT_SCALE;
    const h = (w * o.aspect * image.width) / image.height;
    const maxX = 1 - opts.margin - w;
    const maxY = 1 - opts.margin - h;
    let box: Box | null = null;
    for (let t = 0; t < opts.maxTries && maxX >= opts.margin && maxY >= opts.margin; t++) {
      const cand = { x: opts.margin + rand() * (maxX - opts.margin), y: opts.margin + rand() * (maxY - opts.margin), w, h };
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
