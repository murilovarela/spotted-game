import { describe, expect, it } from "vitest";
import { fitRect, frameGeometry, insideMargin, outputFrameFor, overlapFraction, scaleRatio, toCircle } from "../boxes";

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

describe("outputFrameFor", () => {
  it("returns the smallest 4:3 frame containing the image at native scale", () => {
    expect(outputFrameFor({ width: 1024, height: 768 })).toEqual({ width: 1024, height: 768 });
    expect(outputFrameFor({ width: 424, height: 538 })).toEqual({ width: 718, height: 538 }); // portrait: height kept
    expect(outputFrameFor({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1440 }); // wide: width kept
    expect(outputFrameFor({ width: 896, height: 669 })).toEqual({ width: 896, height: 672 });
  });
});

describe("fitRect", () => {
  it("is the whole frame when the shapes match", () => {
    expect(fitRect({ width: 1024, height: 768 }, { width: 512, height: 384 })).toEqual({ x: 0, y: 0, w: 512, h: 384 });
  });
  it("centres a portrait image with side bands, integer pixels", () => {
    expect(fitRect({ width: 424, height: 538 }, { width: 718, height: 538 })).toEqual({ x: 147, y: 0, w: 424, h: 538 });
    // scaled down to a 512×384 grid: 538 → 384, 424 → 303
    const r = fitRect({ width: 424, height: 538 }, { width: 512, height: 384 });
    expect(r.h).toBe(384);
    expect(r.w).toBe(303);
    expect(r.x).toBe(Math.floor((512 - 303) / 2));
    expect(r.y).toBe(0);
  });
  it("centres a wide image with top and bottom bands", () => {
    expect(fitRect({ width: 1920, height: 1080 }, { width: 1024, height: 768 })).toEqual({ x: 0, y: 96, w: 1024, h: 576 });
  });
});

describe("frameGeometry", () => {
  it("is the whole frame with no voids for a 4:3 image", () => {
    expect(frameGeometry({ width: 1024, height: 768 })).toEqual({ frame: { width: 1024, height: 768 }, content: { x: 0, y: 0, w: 1, h: 1 }, hasVoids: false });
  });
  it("reports voids and the content rect for a portrait image", () => {
    const g = frameGeometry({ width: 424, height: 538 });
    expect(g.frame).toEqual({ width: 718, height: 538 });
    expect(g.content).toEqual({ x: 147 / 718, y: 0, w: 424 / 718, h: 1 });
    expect(g.hasVoids).toBe(true);
  });
  it("ignores rounding bands under 1% of a side", () => {
    // 1024×769 → frame 1026×769: a 2px band, 0.2% of the width — not worth a prompt line.
    const g = frameGeometry({ width: 1024, height: 769 });
    expect(g.frame).toEqual({ width: 1026, height: 769 });
    expect(g.hasVoids).toBe(false);
    // 896×669 (the golden set) → 896×672: 3px of 672.
    expect(frameGeometry({ width: 896, height: 669 }).hasVoids).toBe(false);
    // Exactly 1% counts.
    expect(frameGeometry({ width: 990, height: 750 }).hasVoids).toBe(true); // frame 1000×750: 10px of 1000
  });
});
