import { describe, expect, it } from "vitest";
import { adjustmentFor, composePrompt, formatAdjustments, formatFailures, mergeAdjustments } from "../prompt";

const game = { generalPrompt: "A sunny kitchen, cartoon style, medium difficulty." };
const objects = [
  { id: "a", label: "Coffee mug", prompt: "on the counter, half behind the kettle", requestedScale: 0.1, sortOrder: 0 },
  { id: "b", label: "Rubber duck", prompt: "", requestedScale: null, sortOrder: 1 },
];

describe("composePrompt", () => {
  it("is deterministic and lists objects in sort order with their prompts and sizes", () => {
    const p = composePrompt(game, [...objects].reverse(), []);
    expect(p).toBe(composePrompt(game, objects, []));
    expect(p).toContain("A sunny kitchen, cartoon style, medium difficulty.");
    expect(p.indexOf("Coffee mug")).toBeLessThan(p.indexOf("Rubber duck"));
    expect(p).toContain("1. Coffee mug — on the counter, half behind the kettle — about 10% of the image width");
    expect(p).toContain("2. Rubber duck — placed somewhere plausible");
    expect(p).toContain("do not move, remove or restyle");
  });
  it("appends adjustments, object ones under their object and scene ones at the end", () => {
    const p = composePrompt(game, objects, [
      { objectId: "b", text: "Show the Rubber duck fully in view, not occluded by anything." },
      { objectId: null, text: "Keep every object well separated." },
    ]);
    expect(p).toContain("2. Rubber duck — placed somewhere plausible\n   Adjustment: Show the Rubber duck fully in view, not occluded by anything.");
    expect(p.trimEnd().endsWith("Keep every object well separated.")).toBe(true);
  });
});

describe("adjustmentFor", () => {
  const cup = objects[0];
  it("maps every prompt-related failure class per SPEC §5.3", () => {
    expect(adjustmentFor({ objectId: "a", class: "absent", detail: "" }, cup)).toEqual({
      objectId: "a",
      text: "Place the Coffee mug exactly as described (on the counter, half behind the kettle) and make it clearly visible and larger than before.",
    });
    expect(adjustmentFor({ objectId: "a", class: "low_confidence", detail: "" }, cup)?.text).toBe("Show the Coffee mug fully in view, not occluded by anything.");
    expect(adjustmentFor({ objectId: "a", class: "overlap", detail: "" }, cup)).toEqual({ objectId: null, text: "Keep every object well separated: at least a fifth of the image apart, none touching." });
    expect(adjustmentFor({ objectId: "a", class: "out_of_bounds", detail: "" }, cup)).toEqual({ objectId: null, text: "Place all objects within the central 80% of the frame, away from every edge." });
    expect(adjustmentFor({ objectId: "a", class: "scale", detail: "" }, cup)?.text).toBe("The Coffee mug should be roughly 10% of the image width — about the size of a prominent element of the scene.");
  });
  it("uses a default size when no scale was requested", () => {
    expect(adjustmentFor({ objectId: "b", class: "scale", detail: "" }, objects[1])?.text).toContain("roughly 12% of the image width");
  });
  it("returns null for failures a prompt cannot fix", () => {
    for (const c of ["config", "error", "stale"] as const) expect(adjustmentFor({ objectId: null, class: c, detail: "" }, null)).toBeNull();
  });
});

describe("mergeAdjustments / formatting", () => {
  it("appends without duplicating identical adjustments", () => {
    const a = { objectId: "a", text: "x" };
    expect(mergeAdjustments([a], [a, { objectId: null, text: "y" }])).toEqual([a, { objectId: null, text: "y" }]);
  });
  it("formats failures one per line with the object label", () => {
    expect(formatFailures([{ objectId: "a", class: "absent", detail: "no region" }, { objectId: null, class: "error", detail: "boom" }], objects)).toBe(
      "absent: Coffee mug — no region\nerror: boom",
    );
  });
  it("formats adjustments one per line", () => {
    expect(formatAdjustments([{ objectId: "a", text: "x" }, { objectId: null, text: "y" }])).toBe("x\ny");
    expect(formatAdjustments([])).toBeNull();
  });
});
