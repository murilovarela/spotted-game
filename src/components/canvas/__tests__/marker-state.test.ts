import { describe, expect, it } from "vitest";
import { normalized } from "@/lib/types";
import { canSubmit, EMPTY_MARKERS, markerReducer, type MarkerState } from "../marker-state";

const p = (x: number, y: number) => ({ x: normalized(x), y: normalized(y) });
const add = (s: MarkerState, id: string, max = 3) => markerReducer(s, { type: "add", id, point: p(0.1, 0.1) }, max);

describe("markerReducer", () => {
  it("adds and selects", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(s.markers).toEqual([{ id: "a", x: 0.1, y: 0.1 }]);
    expect(s.selected).toBe("a");
  });
  it("refuses to add past max", () => {
    const s = add(add(add(EMPTY_MARKERS, "a"), "b"), "c");
    expect(add(s, "d")).toBe(s);
  });
  it("moves an existing marker and ignores unknown ids", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(markerReducer(s, { type: "move", id: "a", point: p(0.7, 0.8) }, 3).markers[0]).toEqual({ id: "a", x: 0.7, y: 0.8 });
    expect(markerReducer(s, { type: "move", id: "zz", point: p(0.7, 0.8) }, 3)).toBe(s);
  });
  it("removes and clears selection when the selected one goes", () => {
    const s = add(add(EMPTY_MARKERS, "a"), "b");
    const r = markerReducer(s, { type: "remove", id: "b" }, 3);
    expect(r.markers.map((m) => m.id)).toEqual(["a"]);
    expect(r.selected).toBeNull();
    expect(markerReducer(s, { type: "remove", id: "a" }, 3).selected).toBe("b");
  });
  it("selects", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(markerReducer(s, { type: "select", id: null }, 3).selected).toBeNull();
  });
});

describe("canSubmit", () => {
  it("requires exactly N markers", () => {
    const s = add(add(EMPTY_MARKERS, "a"), "b");
    expect(canSubmit(s, 2)).toBe(true);
    expect(canSubmit(s, 3)).toBe(false);
    expect(canSubmit(s, 1)).toBe(false);
  });
});
