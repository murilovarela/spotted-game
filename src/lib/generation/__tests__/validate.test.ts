import { describe, expect, it } from "vitest";
import { validate } from "../validate";
import type { Candidate, VisionLabel } from "../types";

const image = { width: 1000, height: 1000 };
const box = (x: number, y: number, w = 0.1, h = 0.1): Candidate => ({ x, y, w, h, area: w * h });
const objects = [
  { id: "a", label: "Cup", requestedScale: null },
  { id: "b", label: "Duck", requestedScale: null },
];

describe("validate", () => {
  it("passes with one confident, in-bounds, separated candidate per object", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6)];
    const labels: VisionLabel[] = [
      { candidate: 0, objectId: "a", confidence: 0.9 },
      { candidate: 1, objectId: "b", confidence: 0.8 },
    ];
    const r = validate(objects, candidates, labels, image);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposals.map((p) => p.objectId)).toEqual(["a", "b"]);
      expect(r.proposals[0]).toEqual({ objectId: "a", x: 0.25, y: 0.25, radius: 0.05 });
    }
  });
  it("reports absent when an object has no matched candidate", () => {
    const r = validate(objects, [box(0.2, 0.2)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "b", class: "absent", detail: "no changed region was labelled as this object" }] });
  });
  it("ignores labels pointing at unknown candidates or unknown objects", () => {
    const r = validate(objects, [box(0.2, 0.2)], [{ candidate: 5, objectId: "a", confidence: 0.9 }, { candidate: 0, objectId: "zzz", confidence: 0.9 }], image);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.objectId)).toEqual(["a", "b"]);
  });
  it("keeps the most confident match and drops a decoy", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6), box(0.2, 0.7)];
    const labels: VisionLabel[] = [
      { candidate: 0, objectId: "a", confidence: 0.7 },
      { candidate: 2, objectId: "a", confidence: 0.95 },
      { candidate: 1, objectId: "b", confidence: 0.8 },
    ];
    const r = validate(objects, candidates, labels, image);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposals[0].y).toBeCloseTo(0.75, 10);
  });
  it("reports low_confidence at the threshold boundary (< 0.6 fails, 0.6 passes)", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6)];
    const at = validate(objects, candidates, [{ candidate: 0, objectId: "a", confidence: 0.6 }, { candidate: 1, objectId: "b", confidence: 0.6 }], image);
    expect(at.ok).toBe(true);
    const below = validate(objects, candidates, [{ candidate: 0, objectId: "a", confidence: 0.59 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(below).toEqual({ ok: false, failures: [{ objectId: "a", class: "low_confidence", detail: "confidence 0.59 is below 0.6" }] });
  });
  it("reports out_of_bounds for a box inside the 3% margin", () => {
    const r = validate(objects, [box(0.01, 0.5), box(0.6, 0.6)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "a", class: "out_of_bounds", detail: "box crosses the outer 3% margin" }] });
  });
  // Dyadic values so the boundary is exact in IEEE 754 — no epsilon in the predicate.
  it("reports overlap above 20% for both objects, once each", () => {
    const r = validate(objects, [box(0.125, 0.125, 0.3125, 0.3125), box(0.25, 0.125, 0.3125, 0.3125)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.map((f) => [f.objectId, f.class])).toEqual([["a", "overlap"], ["b", "overlap"]]);
      expect(r.failures[0].detail).toBe("Cup overlaps Duck by 60%");
    }
  });
  it("accepts overlap at exactly 20%", () => {
    const r = validate(objects, [box(0.125, 0.125, 0.3125, 0.3125), box(0.375, 0.125, 0.3125, 0.3125)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r.ok).toBe(true);
  });
  it("reports scale when the area is more than 10× off the requested scale, either way", () => {
    const scaled = [{ id: "a", label: "Cup", requestedScale: 0.1 }];
    const tooBig = validate(scaled, [box(0.2, 0.2, 0.4, 0.4)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(tooBig).toEqual({ ok: false, failures: [{ objectId: "a", class: "scale", detail: "box area is 16.0× the requested scale" }] });
    const tooSmall = validate(scaled, [box(0.2, 0.2, 0.02, 0.02)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(tooSmall.ok).toBe(false);
    const fine = validate(scaled, [box(0.2, 0.2, 0.3, 0.3)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(fine.ok).toBe(true);
  });
  it("reports only the first failing class per object, in SPEC order", () => {
    // a: low confidence AND out of bounds → low_confidence wins
    const r = validate(objects, [box(0.0, 0.5), box(0.6, 0.6)], [{ candidate: 0, objectId: "a", confidence: 0.1 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "a", class: "low_confidence", detail: "confidence 0.10 is below 0.6" }] });
  });
});
