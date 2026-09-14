/**
 * Deterministic pixel diff: which regions of the generated image differ from the
 * background. Vision later labels only these regions (SPEC §5.3), so this is the
 * step that stops the model "finding" an object that was already in the scene.
 * Pure over RGBA Uint8Arrays; no image library.
 */
import type { Candidate } from "./types";

export type DiffOptions = {
  /** Max channel |Δ| (0–255) above which a pixel counts as changed. */
  readonly threshold: number;
  /** 3×3 dilation passes to close gaps between changed pixels. */
  readonly dilations: number;
  /** Components smaller than this fraction of the frame are noise. */
  readonly minAreaFraction: number;
  /** Boxes closer than this (fraction of the frame's width/height) are merged. */
  readonly mergeGap: number;
  readonly maxCandidates: number;
};
export const DIFF_DEFAULTS: DiffOptions = { threshold: 40, dilations: 2, minAreaFraction: 0.0005, mergeGap: 0.02, maxCandidates: 10 };

export type PixelBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type Component = PixelBox & { readonly pixels: number };

export function diffMask(a: Uint8Array, b: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const n = width * height;
  if (a.length !== n * 4 || b.length !== n * 4) throw new Error(`diff: buffer size mismatch (${a.length}, ${b.length}) for ${width}×${height}`);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    if (d > threshold) mask[i] = 1;
  }
  return mask;
}

export function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** 8-connected components via an explicit stack (no recursion), in scan order. */
export function components(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let minX = width, minY = height, maxX = -1, maxY = -1, pixels = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % width;
      const y = (i - x) / width;
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels });
  }
  return out;
}

function touches(a: PixelBox, b: PixelBox, gap: number): boolean {
  return a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h;
}

/** Union boxes that overlap or lie within `gap` pixels, until stable. */
export function mergeBoxes(boxes: readonly PixelBox[], gap: number): PixelBox[] {
  let current = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    const next: PixelBox[] = [];
    for (const b of current) {
      const i = next.findIndex((n) => touches(n, b, gap));
      if (i === -1) {
        next.push(b);
        continue;
      }
      const n = next[i];
      const x = Math.min(n.x, b.x);
      const y = Math.min(n.y, b.y);
      next[i] = { x, y, w: Math.max(n.x + n.w, b.x + b.w) - x, h: Math.max(n.y + n.h, b.y + b.h) - y };
      merged = true;
    }
    current = next;
  }
  return current;
}

export function diffRegions(bg: Uint8Array, gen: Uint8Array, width: number, height: number, opts: DiffOptions = DIFF_DEFAULTS): Candidate[] {
  let mask = diffMask(bg, gen, width, height, opts.threshold);
  for (let i = 0; i < opts.dilations; i++) mask = dilate(mask, width, height);
  const minPixels = opts.minAreaFraction * width * height;
  const boxes = components(mask, width, height).filter((c) => c.pixels >= minPixels);
  const gapPx = Math.round(opts.mergeGap * Math.max(width, height));
  return mergeBoxes(boxes, gapPx)
    .map((b) => ({ x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height, area: (b.w * b.h) / (width * height) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxCandidates);
}
