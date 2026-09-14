import { describe, expect, it } from "vitest";
import { components, DIFF_DEFAULTS, diffMask, diffRegions, dilate, mergeBoxes } from "../diff";

/** Solid-colour RGBA frame with optional rectangles painted over it. */
function frame(w: number, h: number, base: [number, number, number], rects: { x: number; y: number; w: number; h: number; c: [number, number, number] }[] = []): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...base, 255], i * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px.set([...r.c, 255], (y * w + x) * 4);
  return px;
}
const grey: [number, number, number] = [128, 128, 128];
const red: [number, number, number] = [255, 0, 0];

describe("diffMask", () => {
  it("marks pixels whose max channel delta exceeds the threshold", () => {
    const a = frame(4, 1, grey);
    const b = frame(4, 1, grey, [{ x: 1, y: 0, w: 2, h: 1, c: [170, 128, 128] }]);
    expect(Array.from(diffMask(a, b, 4, 1, 40))).toEqual([0, 1, 1, 0]);
    expect(Array.from(diffMask(a, b, 4, 1, 42))).toEqual([0, 0, 0, 0]);
  });
});

describe("dilate", () => {
  it("grows a single pixel into its 3×3 neighbourhood, clipped at the edges", () => {
    const m = new Uint8Array(9);
    m[4] = 1;
    expect(Array.from(dilate(m, 3, 3))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const corner = new Uint8Array(9);
    corner[0] = 1;
    expect(Array.from(dilate(corner, 3, 3))).toEqual([1, 1, 0, 1, 1, 0, 0, 0, 0]);
  });
});

describe("components", () => {
  it("finds 8-connected blobs with pixel boxes", () => {
    const m = new Uint8Array(25);
    for (const i of [0, 1, 5, 6]) m[i] = 1; // 2×2 at top-left
    m[18] = 1; // diagonal neighbour of the next
    m[24] = 1; // bottom-right, 8-connected to 18
    expect(components(m, 5, 5)).toEqual([
      { x: 0, y: 0, w: 2, h: 2, pixels: 4 },
      { x: 3, y: 3, w: 2, h: 2, pixels: 2 },
    ]);
  });
  it("handles a fully set mask without recursion limits", () => {
    const m = new Uint8Array(200 * 200).fill(1);
    expect(components(m, 200, 200)).toEqual([{ x: 0, y: 0, w: 200, h: 200, pixels: 40000 }]);
  });
});

describe("mergeBoxes", () => {
  it("merges boxes that overlap or sit within the gap, transitively", () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 12, y: 0, w: 10, h: 10 },
      { x: 25, y: 0, w: 10, h: 10 },
      { x: 60, y: 60, w: 5, h: 5 },
    ];
    expect(mergeBoxes(boxes, 3)).toEqual([
      { x: 0, y: 0, w: 35, h: 10 },
      { x: 60, y: 60, w: 5, h: 5 },
    ]);
  });
});

describe("diffRegions", () => {
  it("returns one normalized candidate for one pasted rectangle", () => {
    const bg = frame(100, 50, grey);
    const gen = frame(100, 50, grey, [{ x: 10, y: 5, w: 20, h: 10, c: red }]);
    const [c, ...rest] = diffRegions(bg, gen, 100, 50);
    expect(rest).toEqual([]);
    // one dilation pass (DIFF_DEFAULTS.dilations = 1) grows the box by 1px per side; assert within that tolerance
    expect(c.x).toBeGreaterThanOrEqual(0.08);
    expect(c.x).toBeLessThanOrEqual(0.1);
    expect(c.w).toBeGreaterThanOrEqual(0.2);
    expect(c.w).toBeLessThanOrEqual(0.24);
    expect(c.area).toBeCloseTo(c.w * c.h, 10);
  });
  it("returns two candidates for two separated rectangles, largest first", () => {
    const bg = frame(100, 100, grey);
    const gen = frame(100, 100, grey, [
      { x: 5, y: 5, w: 10, h: 10, c: red },
      { x: 50, y: 50, w: 30, h: 30, c: red },
    ]);
    const cs = diffRegions(bg, gen, 100, 100);
    expect(cs).toHaveLength(2);
    expect(cs[0].area).toBeGreaterThan(cs[1].area);
  });
  it("ignores speckle noise below the minimum area and identical frames", () => {
    const bg = frame(100, 100, grey);
    const noisy = frame(100, 100, grey, [{ x: 40, y: 40, w: 1, h: 1, c: red }]);
    expect(diffRegions(bg, noisy, 100, 100, { ...DIFF_DEFAULTS, dilations: 0 })).toEqual([]);
    expect(diffRegions(bg, bg, 100, 100)).toEqual([]);
  });
  it("caps the number of candidates", () => {
    const bg = frame(100, 100, grey);
    const rects = Array.from({ length: 6 }, (_, i) => ({ x: i * 16, y: 10, w: 8, h: 8, c: red }));
    const gen = frame(100, 100, grey, rects);
    expect(diffRegions(bg, gen, 100, 100, { ...DIFF_DEFAULTS, mergeGap: 0, maxCandidates: 4 })).toHaveLength(4);
  });
  it("throws on mismatched buffer sizes", () => {
    expect(() => diffRegions(new Uint8Array(16), new Uint8Array(32), 2, 2)).toThrow(/size/);
  });
});
