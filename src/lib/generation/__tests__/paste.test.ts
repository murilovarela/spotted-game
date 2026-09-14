import { describe, expect, it } from "vitest";
import { decodeRGBA, dimensions, encodePng } from "../images";
import { createPasteBackend } from "../paste";
import { diffRegions } from "../diff";

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return encodePng(data, { width, height });
}

describe("paste backend", () => {
  it("composites objects at its own placements and labels the matching candidates", async () => {
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
    expect(await dimensions(scene.png)).toEqual({ width: 200, height: 100 });
    const bg = await decodeRGBA(background);
    const gen = await decodeRGBA(scene.png);
    const candidates = diffRegions(bg.data, gen.data, 200, 100);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const { labels } = await backend.label({ game, scene, candidates, crops: [] });
    expect(labels.map((l) => l.objectId).sort()).toEqual(["a", "b"]);
    for (const l of labels) expect(l.confidence).toBe(1);
  });
});
