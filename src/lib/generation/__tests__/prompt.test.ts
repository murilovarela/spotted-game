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
    expect(p).toContain("This image is for a hidden-object game: a player must find each listed object by looking carefully. Every object must be small relative to the frame and hidden in a plausible spot — partly tucked behind or among scene elements, matching the scene's lighting, perspective and scale — but it must remain genuinely findable: fully rendered, recognisable from its reference image, and not covered more than about half.");
    expect(p).toContain("Rules: no object entirely hidden; no two objects overlapping; nothing touching the frame edges; keep each object recognisable from its reference image.");
    expect(p).not.toContain("fully visible");
    // The game line follows the scene line.
    expect(p.indexOf("Scene:")).toBeLessThan(p.indexOf("This image is for a hidden-object game"));
    expect(p).toContain("The output is a 4:3 landscape frame. If the supplied background has a different shape, extend the scene naturally to fill the frame; do not crop or stretch it.");
  });
  it("explains the grey bands only when the letterboxed background has voids", () => {
    const bands = "The flat grey bands at the edges are empty space: extend the scene naturally into them. Keep the photographed area exactly where it is and as it is.";
    expect(composePrompt(game, objects, [])).not.toContain(bands);
    expect(composePrompt({ ...game, hasVoids: false }, objects, [])).not.toContain(bands);
    const p = composePrompt({ ...game, hasVoids: true }, objects, []);
    expect(p).toContain(bands);
    expect(p.indexOf("4:3 landscape frame")).toBeLessThan(p.indexOf(bands));
  });
  it("appends adjustments, object ones under their object and scene ones at the end", () => {
    const p = composePrompt(game, objects, [
      { objectId: "b", text: "Show more of the Rubber duck: at most half of it may be covered." },
      { objectId: null, text: "Keep every object well separated." },
    ]);
    expect(p).toContain("2. Rubber duck — placed somewhere plausible\n   Adjustment: Show more of the Rubber duck: at most half of it may be covered.");
    expect(p.trimEnd().endsWith("Keep every object well separated.")).toBe(true);
  });
});

describe("adjustmentFor", () => {
  const cup = objects[0];
  it("maps every prompt-related failure class per SPEC §5.3", () => {
    expect(adjustmentFor({ objectId: "a", class: "absent", detail: "" }, cup)).toEqual({
      objectId: "a",
      text: "Place the Coffee mug exactly as described (on the counter, half behind the kettle), slightly larger than before and less occluded, so a careful player can find it.",
    });
    expect(adjustmentFor({ objectId: "a", class: "absent", detail: "" }, objects[1])?.text).toBe("Place the Rubber duck in a plausible spot, slightly larger than before and less occluded, so a careful player can find it.");
    expect(adjustmentFor({ objectId: "a", class: "low_confidence", detail: "" }, cup)?.text).toBe("Show more of the Coffee mug: at most half of it may be covered.");
    expect(adjustmentFor({ objectId: "a", class: "overlap", detail: "" }, cup)).toEqual({ objectId: null, text: "Keep every object well separated: at least a fifth of the image apart, none touching." });
    expect(adjustmentFor({ objectId: "a", class: "out_of_bounds", detail: "" }, cup)).toEqual({ objectId: null, text: "Place all objects within the central 80% of the frame, away from every edge." });
    expect(adjustmentFor({ objectId: "a", class: "scale", detail: "" }, cup)?.text).toBe("The Coffee mug should be roughly 10% of the image width — about the size of a prominent element of the scene.");
  });
  it("maps background_altered to a scene-level instruction to edit in place", () => {
    expect(adjustmentFor({ objectId: null, class: "background_altered", detail: "" }, null)).toEqual({
      objectId: null,
      text: "Edit the supplied background image in place: keep every existing pixel, colour and element exactly as it is, and change nothing except adding the listed objects.",
    });
  });
  it("uses a default size when no scale was requested", () => {
    expect(adjustmentFor({ objectId: "b", class: "scale", detail: "" }, objects[1])?.text).toContain("roughly 6% of the image width");
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
