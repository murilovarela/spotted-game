import { describe, expect, it } from "vitest";
import { decodeRGBA, dimensions, encodePng, letterboxTo } from "../images";
import { createPasteBackend } from "../paste";
import { diffRegions } from "../diff";

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return encodePng(data, { width, height });
}

describe("paste backend", () => {
  it("composites onto the background letterboxed to 4:3, inside the real area, and labels the matching candidates", async () => {
    const background = await solid(200, 100, [120, 120, 120]);
    const sprite = await solid(10, 10, [255, 0, 0]);
    const game = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "t",
      generalPrompt: "",
      background,
      objects: [
        { id: "a", label: "A", prompt: "", requestedScale: 0.1, sortOrder: 0, image: sprite },
        { id: "b", label: "B", prompt: "", requestedScale: 0.1, sortOrder: 1, image: sprite },
      ],
    };
    const backend = createPasteBackend();
    const scene = await backend.compose({ ...game, prompt: "ignored" });
    // 200×100 is wider than 4:3: the frame keeps the width and adds bands top and bottom.
    expect(scene).toMatchObject({ width: 200, height: 150 });
    expect(await dimensions(scene.png)).toEqual({ width: 200, height: 150 });
    const boxed = await letterboxTo(background, { width: 200, height: 150 });
    const bg = await decodeRGBA(boxed.png);
    const gen = await decodeRGBA(scene.png);
    const candidates = diffRegions(bg.data, gen.data, 200, 150, undefined, boxed.mask);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // Every pasted object sits on real background (rows 25..124 of 150), not in a band.
    for (const c of candidates) {
      expect(c.y).toBeGreaterThanOrEqual(25 / 150);
      expect(c.y + c.h).toBeLessThanOrEqual(125 / 150);
    }
    const { labels } = await backend.label({ game, scene, candidates, crops: [] });
    expect(labels.map((l) => l.objectId).sort()).toEqual(["a", "b"]);
    for (const l of labels) expect(l.confidence).toBe(1);
    // locate answers with the same known placements, for the objects asked about only.
    const located = await backend.locate?.({ scene, objects: [game.objects[1], { ...game.objects[0], id: "unknown" }] });
    expect(located?.boxes).toHaveLength(1);
    expect(located?.boxes[0]).toMatchObject({ objectId: "b", confidence: 1 });
    expect(candidates.some((c) => c.x <= (located?.boxes[0].box.x ?? -1) && c.x + c.w >= (located?.boxes[0].box.x ?? 2))).toBe(true);
  });
});
