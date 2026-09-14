/** Pure box maths over normalized boxes (see types.ts). No I/O. */
import { normalized, type ImageSize, type NormalizedCircle } from "@/lib/types";
import type { Box } from "./types";

/** Intersection area over the smaller box's area; 0 when disjoint or merely touching. */
export function overlapFraction(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

/** True when the whole box lies inside the frame minus `margin` on every side (inclusive). */
export function insideMargin(b: Box, margin: number): boolean {
  return b.x >= margin && b.y >= margin && b.x + b.w <= 1 - margin && b.y + b.h <= 1 - margin;
}

/**
 * The hit circle for a box: its centre, and half its larger side measured in width units
 * — the same aspect-aware unit scoring.ts uses. Capped at 0.5.
 */
export function toCircle(b: Box, image: ImageSize): NormalizedCircle {
  const hInWidthUnits = (b.h * image.height) / image.width;
  const r = Math.max(b.w, hInWidthUnits) / 2;
  return { x: normalized(b.x + b.w / 2), y: normalized(b.y + b.h / 2), radius: normalized(Math.min(0.5, r)) };
}

/**
 * Box area relative to the area a square of `requestedScale × width` pixels would cover.
 * 1 = exactly the requested size; SPEC §5.3 tolerates an order of magnitude either way.
 */
export function scaleRatio(b: Box, requestedScale: number, image: ImageSize): number {
  const expected = requestedScale * requestedScale * (image.width / image.height);
  return (b.w * b.h) / expected;
}
