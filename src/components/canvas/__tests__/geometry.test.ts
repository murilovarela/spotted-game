import { describe, expect, it } from "vitest";
import { normalized } from "@/lib/types";
import {
  clamp01,
  MIN_RADIUS,
  MAX_RADIUS,
  NUDGE_STEP,
  nudge,
  radiusFromHandle,
  radiusPx,
  toNormalized,
  toPixel,
} from "../geometry";

const rect = { left: 100, top: 50, width: 400, height: 300 };
const image = { width: 1024, height: 768 };

describe("clamp01", () => {
  it("clamps into [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });
});

describe("toNormalized", () => {
  it("maps a pointer inside the rect", () => {
    expect(toNormalized(200, 125, rect, { clamp: false })).toEqual({ x: 0.25, y: 0.25 });
  });
  it("returns null outside the rect when not clamping", () => {
    expect(toNormalized(99, 125, rect, { clamp: false })).toBeNull();
    expect(toNormalized(200, 351, rect, { clamp: false })).toBeNull();
  });
  it("clamps outside the rect when clamping (drag past the edge)", () => {
    expect(toNormalized(0, 0, rect, { clamp: true })).toEqual({ x: 0, y: 0 });
    expect(toNormalized(900, 900, rect, { clamp: true })).toEqual({ x: 1, y: 1 });
  });
  it("includes the boundary", () => {
    expect(toNormalized(500, 350, rect, { clamp: false })).toEqual({ x: 1, y: 1 });
  });
  it("returns null for a degenerate rect", () => {
    expect(toNormalized(0, 0, { ...rect, width: 0 }, { clamp: true })).toBeNull();
  });
});

describe("toPixel / radiusPx", () => {
  it("scales by the image dimensions", () => {
    expect(toPixel({ x: normalized(0.5), y: normalized(0.25) }, image)).toEqual({ x: 512, y: 192 });
  });
  it("radius is a fraction of width (plain circle in pixel space)", () => {
    expect(radiusPx(normalized(0.05), image)).toBe(51.2);
  });
});

describe("radiusFromHandle", () => {
  const center = { x: normalized(0.5), y: normalized(0.5) };
  it("measures pixel distance and divides by width", () => {
    // handle 0.1 right in normalized x = 102.4px → 0.1
    expect(radiusFromHandle(center, { x: normalized(0.6), y: normalized(0.5) }, image)).toBeCloseTo(0.1, 10);
  });
  it("is aspect-aware: vertical offset is scaled by height/width", () => {
    // 0.1 down in normalized y = 76.8px → 0.075 of width
    expect(radiusFromHandle(center, { x: normalized(0.5), y: normalized(0.6) }, image)).toBeCloseTo(0.075, 10);
  });
  it("clamps to [MIN_RADIUS, MAX_RADIUS]", () => {
    expect(radiusFromHandle(center, center, image)).toBe(MIN_RADIUS);
    expect(radiusFromHandle({ x: normalized(0), y: normalized(0) }, { x: normalized(1), y: normalized(1) }, image)).toBe(MAX_RADIUS);
  });
});

describe("nudge", () => {
  it("moves by one step and clamps", () => {
    expect(nudge({ x: normalized(0.5), y: normalized(0.5) }, 1, 0)).toEqual({ x: 0.5 + NUDGE_STEP, y: 0.5 });
    expect(nudge({ x: normalized(0), y: normalized(1) }, -1, 1)).toEqual({ x: 0, y: 1 });
  });
});
