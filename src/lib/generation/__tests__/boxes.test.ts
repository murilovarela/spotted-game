import { describe, expect, it } from "vitest";
import { insideMargin, overlapFraction, scaleRatio, toCircle } from "../boxes";

const image = { width: 1000, height: 500 };

describe("overlapFraction", () => {
  it("is 0 for disjoint boxes", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });
  it("is intersection over the smaller box", () => {
    // small 0.1×0.1 box half inside a big one → 0.5
    expect(overlapFraction({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.45, y: 0, w: 0.1, h: 0.1 })).toBeCloseTo(0.5, 10);
  });
  it("is 1 when one box contains the other", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBe(1);
  });
  it("treats touching edges as no overlap", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.1, y: 0, w: 0.1, h: 0.1 })).toBe(0);
  });
});

describe("insideMargin", () => {
  it("accepts a box strictly inside the margin, inclusive at the boundary", () => {
    expect(insideMargin({ x: 0.03, y: 0.03, w: 0.94, h: 0.94 }, 0.03)).toBe(true);
  });
  it("rejects a box crossing any edge", () => {
    expect(insideMargin({ x: 0.02, y: 0.5, w: 0.1, h: 0.1 }, 0.03)).toBe(false);
    expect(insideMargin({ x: 0.5, y: 0.5, w: 0.5, h: 0.1 }, 0.03)).toBe(false);
  });
});

describe("toCircle", () => {
  it("centres the box and uses the larger side in width units (aspect-aware)", () => {
    // 2:1 image: a box 0.1 wide and 0.1 tall is 100px × 50px → radius 50px = 0.05 of width
    const c = toCircle({ x: 0.2, y: 0.4, w: 0.1, h: 0.1 }, image);
    expect(c.x).toBeCloseTo(0.25, 10);
    expect(c.y).toBeCloseTo(0.45, 10);
    expect(c.radius).toBeCloseTo(0.05, 10);
    // tall box: 0.02 wide (20px), 0.2 tall (100px) → radius 50px = 0.05
    expect(toCircle({ x: 0, y: 0, w: 0.02, h: 0.2 }, image).radius).toBeCloseTo(0.05, 10);
  });
  it("caps the radius at 0.5", () => {
    expect(toCircle({ x: 0, y: 0, w: 1, h: 1 }, { width: 100, height: 400 }).radius).toBe(0.5);
  });
});

describe("scaleRatio", () => {
  it("is 1 when the box area matches a square of requestedScale width", () => {
    // requestedScale 0.1 on a 2:1 image: 100px wide square → 100×100px = w 0.1, h 0.2
    expect(scaleRatio({ x: 0, y: 0, w: 0.1, h: 0.2 }, 0.1, image)).toBeCloseTo(1, 10);
  });
  it("scales with area", () => {
    expect(scaleRatio({ x: 0, y: 0, w: 0.2, h: 0.4 }, 0.1, image)).toBeCloseTo(4, 10);
  });
});
