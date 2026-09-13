import { describe, expect, it } from "vitest";
import { isNormalized, normalizePixel, normalized } from "../types";

describe("normalized", () => {
  it("accepts the closed interval [0, 1]", () => {
    expect(normalized(0)).toBe(0);
    expect(normalized(1)).toBe(1);
    expect(normalized(0.5)).toBe(0.5);
  });

  it.each([-0.001, 1.001, NaN, Infinity, -Infinity])("rejects %s", (n) => {
    expect(() => normalized(n)).toThrow(RangeError);
    expect(isNormalized(n)).toBe(false);
  });
});

describe("normalizePixel", () => {
  it("divides by the extent", () => {
    expect(normalizePixel(256, 1024)).toBe(0.25);
  });

  it("rejects pixels outside the image", () => {
    expect(() => normalizePixel(1025, 1024)).toThrow(RangeError);
    expect(() => normalizePixel(-1, 1024)).toThrow(RangeError);
  });

  it("rejects a non-positive extent", () => {
    expect(() => normalizePixel(0, 0)).toThrow(RangeError);
  });
});
