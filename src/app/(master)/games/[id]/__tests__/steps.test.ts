import { describe, expect, it } from "vitest";
import { normalized, type MasterGameView, type ObjectForMaster } from "@/lib/types";
import { deriveSteps, publishBlockers } from "../steps";

const obj = (over: Partial<ObjectForMaster> = {}): ObjectForMaster => ({
  id: "o1",
  label: "Cup",
  sourceImageUrl: "u",
  sortOrder: 0,
  prompt: "",
  x: normalized(0.5),
  y: normalized(0.5),
  radius: normalized(0.05),
  confirmed: true,
  ...over,
});

const game = (over: Partial<MasterGameView> = {}): MasterGameView => ({
  viewer: "master",
  status: "draft",
  id: "g1",
  publicId: "p1",
  title: "T",
  generalPrompt: "",
  backgroundUrl: "bg",
  image: { url: "img", width: 1200, height: 896 },
  publishedAt: null,
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-10-02T00:00:00Z"),
  objects: [obj()],
  generationRuns: [],
  ...over,
});

describe("deriveSteps", () => {
  it("marks every step done for a publishable draft", () => {
    expect(deriveSteps(game()).map((s) => [s.key, s.done])).toEqual([
      ["background", true],
      ["objects", true],
      ["generate", true],
      ["positions", true],
      ["window", true],
    ]);
  });
  it("positions is not done while any object is unconfirmed or unplaced", () => {
    expect(deriveSteps(game({ objects: [obj({ confirmed: false })] })).find((s) => s.key === "positions")?.done).toBe(false);
    expect(deriveSteps(game({ objects: [obj({ x: null, y: null, radius: null })] })).find((s) => s.key === "positions")?.done).toBe(false);
  });
  it("generate is not done without an image; window not done when either end is null", () => {
    expect(deriveSteps(game({ image: null })).find((s) => s.key === "generate")?.done).toBe(false);
    expect(deriveSteps(game({ endsAt: null })).find((s) => s.key === "window")?.done).toBe(false);
  });
  it("positions hint reports what's left: unplaced, then unconfirmed, then done", () => {
    const hint = (o: ObjectForMaster) => deriveSteps(game({ objects: [o] })).find((s) => s.key === "positions")?.hint;
    expect(hint(obj({ x: null, y: null, radius: null }))).toBe("1 not placed yet.");
    expect(hint(obj({ confirmed: false }))).toBe("1 to confirm.");
    expect(hint(obj())).toBe("Every circle checked.");
  });
});

describe("publishBlockers", () => {
  it("is empty for a publishable draft", () => {
    expect(publishBlockers(game())).toEqual([]);
  });
  it("lists every blocker, in step order, with counts", () => {
    expect(publishBlockers(game({ backgroundUrl: null, image: null, objects: [obj({ confirmed: false }), obj({ id: "o2", confirmed: false })], startsAt: null }))).toEqual([
      "Upload a background",
      "Generate the image",
      "Confirm 2 objects",
      "Set the play window",
    ]);
  });
  it("asks for objects when there are none", () => {
    expect(publishBlockers(game({ objects: [] }))).toEqual(["Add at least one object"]);
  });
  it("singularizes the count when exactly one object is unconfirmed", () => {
    expect(publishBlockers(game({ objects: [obj({ confirmed: false })] }))).toEqual(["Confirm 1 object"]);
  });
});
