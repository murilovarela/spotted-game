import { describe, expect, it } from "vitest";
import { overlapFraction } from "../boxes";
import { placeObjects, seededRandom } from "../placement";

const image = { width: 1024, height: 768 };
const five = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, requestedScale: null, aspect: 1 }));

describe("seededRandom", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = seededRandom("game-1");
    const b = seededRandom("game-1");
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(seededRandom("game-2")()).not.toBe(xs[0]);
  });
});

describe("placeObjects", () => {
  it("places five objects inside the margin without overlap, deterministically", () => {
    const boxes = placeObjects(five, image, "seed");
    expect(boxes).toHaveLength(5);
    expect(placeObjects(five, image, "seed")).toEqual(boxes);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0.1);
      expect(b.y).toBeGreaterThanOrEqual(0.1);
      expect(b.x + b.w).toBeLessThanOrEqual(0.9);
      expect(b.y + b.h).toBeLessThanOrEqual(0.9);
    }
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(overlapFraction(boxes[i], boxes[j])).toBe(0);
  });
  it("sizes each box from requestedScale (or 0.12) as a fraction of width, aspect-aware", () => {
    const [b] = placeObjects([{ id: "a", requestedScale: 0.2, aspect: 2 }], image, "s"); // aspect = height/width of the sprite
    expect(b.w).toBeCloseTo(0.2, 10);
    expect(b.h).toBeCloseTo((0.2 * 2 * image.width) / image.height, 10);
    expect(placeObjects([{ id: "a", requestedScale: null, aspect: 1 }], image, "s")[0].w).toBeCloseTo(0.12, 10);
  });
  it("throws when nothing fits", () => {
    expect(() => placeObjects([{ id: "a", requestedScale: 0.9, aspect: 1 }], image, "s")).toThrow(/place/);
  });
});
