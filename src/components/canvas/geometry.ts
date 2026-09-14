/**
 * Pure coordinate maths for the canvas. Radius is a fraction of image *width* (Phase 0
 * decision, mirrored in scoring.ts); in image-pixel space that is a plain circle, so
 * what the master sees is exactly the geometry players are scored against.
 */
import { normalized, type ImageSize, type Normalized, type NormalizedPoint } from "@/lib/types";

export type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** 1/200 of the frame per arrow-key press. */
export const NUDGE_STEP = 0.005;
export const MIN_RADIUS = 0.01;
export const MAX_RADIUS = 0.5;
export const DEFAULT_RADIUS = 0.05;

export function clamp01(n: number): Normalized {
  return normalized(Math.min(1, Math.max(0, n)));
}

/**
 * Pointer position → normalized point. With `clamp: false` a pointer outside the rect
 * yields `null` (a click outside the image adds nothing); with `clamp: true` it is
 * clamped (a drag past the edge pins the marker to the edge).
 */
export function toNormalized(clientX: number, clientY: number, rect: Rect, opts: { clamp: boolean }): NormalizedPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!opts.clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

export function toPixel(p: NormalizedPoint, image: ImageSize): { x: number; y: number } {
  return { x: p.x * image.width, y: p.y * image.height };
}

export function radiusPx(radius: Normalized, image: ImageSize): number {
  return radius * image.width;
}

/** Distance centre→handle in pixel space, as a fraction of width, clamped to the allowed range. */
export function radiusFromHandle(center: NormalizedPoint, handle: NormalizedPoint, image: ImageSize): Normalized {
  const c = toPixel(center, image);
  const h = toPixel(handle, image);
  const r = Math.hypot(h.x - c.x, h.y - c.y) / image.width;
  return normalized(Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r)));
}

export function nudge(p: NormalizedPoint, dx: -1 | 0 | 1, dy: -1 | 0 | 1): NormalizedPoint {
  return { x: clamp01(p.x + dx * NUDGE_STEP), y: clamp01(p.y + dy * NUDGE_STEP) };
}
