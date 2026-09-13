import { describe, expect, it } from "vitest";
import { scoreAttempt, type ScorableObject } from "../scoring";
import { normalized, type ImageSize, type NormalizedPoint } from "../types";

const SQUARE: ImageSize = { width: 1000, height: 1000 };

const pt = (x: number, y: number): NormalizedPoint => ({ x: normalized(x), y: normalized(y) });
const obj = (id: string, x: number, y: number, radius: number): ScorableObject => ({
  id,
  x: normalized(x),
  y: normalized(y),
  radius: normalized(radius),
});

describe("scoreAttempt", () => {
  it("scores nothing when there are no markers", () => {
    const result = scoreAttempt({ markers: [], objects: [obj("a", 0.5, 0.5, 0.1)], image: SQUARE });
    expect(result).toEqual({ foundCount: 0, assignments: [] });
  });

  it("scores a marker inside the radius as a hit", () => {
    const result = scoreAttempt({
      markers: [pt(0.52, 0.48)],
      objects: [obj("a", 0.5, 0.5, 0.1)],
      image: SQUARE,
    });
    expect(result).toEqual({ foundCount: 1, assignments: ["a"] });
  });

  it("scores a marker outside the radius as a miss", () => {
    const result = scoreAttempt({
      markers: [pt(0.9, 0.9)],
      objects: [obj("a", 0.5, 0.5, 0.1)],
      image: SQUARE,
    });
    expect(result).toEqual({ foundCount: 0, assignments: [null] });
  });

  describe("boundary", () => {
    // 0.5, 0.75 and 0.25 are exact in binary, so the distance is exactly the radius.
    const objects = [obj("a", 0.5, 0.5, 0.25)];

    it("counts a marker exactly on the radius as a hit (inclusive)", () => {
      const onEdgeX = scoreAttempt({ markers: [pt(0.75, 0.5)], objects, image: SQUARE });
      const onEdgeY = scoreAttempt({ markers: [pt(0.5, 0.25)], objects, image: SQUARE });
      expect(onEdgeX.foundCount).toBe(1);
      expect(onEdgeY.foundCount).toBe(1);
    });

    it("counts a marker just beyond the radius as a miss", () => {
      const result = scoreAttempt({ markers: [pt(0.75 + 1e-9, 0.5)], objects, image: SQUARE });
      expect(result.foundCount).toBe(0);
    });

    it("counts a marker at the object centre as a hit", () => {
      const result = scoreAttempt({ markers: [pt(0.5, 0.5)], objects, image: SQUARE });
      expect(result.foundCount).toBe(1);
    });

    it("counts a zero-radius object as hit only at its exact centre", () => {
      const point = [obj("a", 0.5, 0.5, 0)];
      expect(scoreAttempt({ markers: [pt(0.5, 0.5)], objects: point, image: SQUARE }).foundCount).toBe(1);
      expect(scoreAttempt({ markers: [pt(0.5, 0.5001)], objects: point, image: SQUARE }).foundCount).toBe(0);
    });
  });

  describe("aspect ratio", () => {
    // Radius is a fraction of width. On a 2:1 image, 0.1 = 200px; a 0.15 offset in y
    // is 150px (hit) while the same offset in x is 300px (miss).
    const wide: ImageSize = { width: 2000, height: 1000 };
    const objects = [obj("a", 0.5, 0.5, 0.1)];

    it("scales y by height/width so the hit region is a circle in pixels", () => {
      expect(scoreAttempt({ markers: [pt(0.5, 0.65)], objects, image: wide }).foundCount).toBe(1);
      expect(scoreAttempt({ markers: [pt(0.65, 0.5)], objects, image: wide }).foundCount).toBe(0);
    });

    it("is exact on the boundary for a tall image", () => {
      // 1:2 image, radius 0.25 of width = 250px; dy of 0.125 = 250px → exactly on the edge.
      // All values are dyadic so the float arithmetic is exact.
      const tall: ImageSize = { width: 1000, height: 2000 };
      const quarter = [obj("a", 0.5, 0.5, 0.25)];
      expect(scoreAttempt({ markers: [pt(0.5, 0.625)], objects: quarter, image: tall }).foundCount).toBe(1);
      expect(scoreAttempt({ markers: [pt(0.5, 0.625 + 1e-9)], objects: quarter, image: tall }).foundCount).toBe(0);
    });
  });

  describe("double marker", () => {
    const objects = [obj("a", 0.5, 0.5, 0.1)];

    it("lets only the closer of two markers on one object score", () => {
      const result = scoreAttempt({
        markers: [pt(0.55, 0.5), pt(0.52, 0.5)],
        objects,
        image: SQUARE,
      });
      expect(result).toEqual({ foundCount: 1, assignments: [null, "a"] });
    });

    it("never scores more than the number of objects", () => {
      const result = scoreAttempt({
        markers: [pt(0.5, 0.5), pt(0.51, 0.5), pt(0.5, 0.51), pt(0.49, 0.5), pt(0.5, 0.49)],
        objects,
        image: SQUARE,
      });
      expect(result.foundCount).toBe(1);
      expect(result.assignments.filter((a) => a !== null)).toHaveLength(1);
    });
  });

  describe("assignment", () => {
    it("assigns each marker to at most one object and each object to at most one marker", () => {
      const objects = [obj("a", 0.2, 0.2, 0.1), obj("b", 0.8, 0.8, 0.1), obj("c", 0.2, 0.8, 0.1)];
      const result = scoreAttempt({
        markers: [pt(0.8, 0.8), pt(0.2, 0.2), pt(0.5, 0.5)],
        objects,
        image: SQUARE,
      });
      expect(result).toEqual({ foundCount: 2, assignments: ["b", "a", null] });
    });

    it("does not let a miss consume an object", () => {
      // First marker is nearest to "a" but outside its radius; the second is inside.
      const result = scoreAttempt({
        markers: [pt(0.65, 0.5), pt(0.55, 0.5)],
        objects: [obj("a", 0.5, 0.5, 0.1)],
        image: SQUARE,
      });
      expect(result).toEqual({ foundCount: 1, assignments: [null, "a"] });
    });

    it("is independent of marker order", () => {
      const objects = [obj("a", 0.3, 0.3, 0.1), obj("b", 0.7, 0.7, 0.1)];
      const markers = [pt(0.32, 0.3), pt(0.7, 0.68), pt(0.5, 0.5)];
      const forward = scoreAttempt({ markers, objects, image: SQUARE });
      const reversed = scoreAttempt({ markers: [...markers].reverse(), objects, image: SQUARE });
      expect(forward.foundCount).toBe(reversed.foundCount);
      expect([...reversed.assignments].reverse()).toEqual(forward.assignments);
    });

    it("is greedy by global distance, not optimal", () => {
      // m1 hits both a (closer) and b; m2 hits only a. Greedy gives m1→a and strands m2.
      // Optimal assignment would score 2; greedy scores 1. Spec §6.6 accepts this.
      const objects = [obj("a", 0.5, 0.5, 0.1), obj("b", 0.5, 0.65, 0.1)];
      const result = scoreAttempt({
        markers: [pt(0.5, 0.56), pt(0.5, 0.42)],
        objects,
        image: SQUARE,
      });
      expect(result).toEqual({ foundCount: 1, assignments: ["a", null] });
    });

    it("breaks exact ties deterministically by marker index, then object index", () => {
      const objects = [obj("a", 0.25, 0.5, 0.25), obj("b", 0.75, 0.5, 0.25)];
      // Both markers equidistant from both objects (all distances exactly 0.25).
      const result = scoreAttempt({
        markers: [pt(0.5, 0.5), pt(0.5, 0.5)],
        objects,
        image: SQUARE,
      });
      expect(result).toEqual({ foundCount: 2, assignments: ["a", "b"] });
    });
  });

  it("does not mutate its inputs", () => {
    const markers = [pt(0.5, 0.5), pt(0.1, 0.1)];
    const objects = [obj("a", 0.5, 0.5, 0.1)];
    const markersCopy = structuredClone(markers);
    const objectsCopy = structuredClone(objects);
    scoreAttempt({ markers, objects, image: SQUARE });
    expect(markers).toEqual(markersCopy);
    expect(objects).toEqual(objectsCopy);
  });
});
