/** Pure box maths over normalized boxes (see types.ts). No I/O. */
import { normalized, type ImageSize, type NormalizedCircle } from "@/lib/types";
import { OUTPUT_ASPECT, type Box } from "./types";

export type PixelRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

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

/** The smallest `OUTPUT_ASPECT` frame that contains `size` at native scale (one side is kept). */
export function outputFrameFor(size: ImageSize): ImageSize {
  const target = OUTPUT_ASPECT.w / OUTPUT_ASPECT.h;
  if (size.width / size.height >= target) return { width: size.width, height: Math.ceil(size.width / target) };
  return { width: Math.ceil(size.height * target), height: size.height };
}

/** Where `content` lands when scaled to fit inside `frame` and centred, in integer frame pixels. */
export function fitRect(content: ImageSize, frame: ImageSize): PixelRect {
  const scale = Math.min(frame.width / content.width, frame.height / content.height);
  const w = Math.min(frame.width, Math.max(1, Math.round(content.width * scale)));
  const h = Math.min(frame.height, Math.max(1, Math.round(content.height * scale)));
  return { x: Math.floor((frame.width - w) / 2), y: Math.floor((frame.height - h) / 2), w, h };
}

export type FrameGeometry = {
  /** The output frame the background is letterboxed into, at native scale. */
  readonly frame: ImageSize;
  /** Where the real background lies in that frame, normalized. */
  readonly content: Box;
  /** True when a fill band is at least `VOID_MIN_FRACTION` of its side; rounding slivers do not count. */
  readonly hasVoids: boolean;
};
const VOID_MIN_FRACTION = 0.01;

/** How a background of `dims` sits in the fixed output frame; what the model is given and what the diff compares. */
export function frameGeometry(dims: ImageSize): FrameGeometry {
  const frame = outputFrameFor(dims);
  const rect = fitRect(dims, frame);
  const content = { x: rect.x / frame.width, y: rect.y / frame.height, w: rect.w / frame.width, h: rect.h / frame.height };
  const hasVoids = 1 - content.w >= VOID_MIN_FRACTION || 1 - content.h >= VOID_MIN_FRACTION;
  return { frame, content, hasVoids };
}
