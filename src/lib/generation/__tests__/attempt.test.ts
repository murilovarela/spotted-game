import { describe, expect, it } from "vitest";
import { attemptOnce } from "../attempt";
import type { GenerationBackend, LabelInput } from "../backend";
import { encodePng } from "../images";
import type { GameInput, VisionLabel } from "../types";

const SIZE = { width: 64, height: 64 };

async function scene(rect?: { x: number; y: number; w: number; h: number }): Promise<Uint8Array> {
  const data = new Uint8Array(SIZE.width * SIZE.height * 4);
  for (let i = 0; i < SIZE.width * SIZE.height; i++) data.set([120, 120, 120, 255], i * 4);
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) data.set([255, 0, 0, 255], (y * SIZE.width + x) * 4);
  }
  return encodePng(data, SIZE);
}

function fake(composed: Uint8Array, labels: (input: LabelInput) => VisionLabel[]): GenerationBackend & { labelCalls: number } {
  const b = {
    name: "fake",
    labelCalls: 0,
    compose: async () => ({ png: composed, ...SIZE }),
    label: async (input: LabelInput) => {
      b.labelCalls++;
      return { labels: labels(input), raw: { fake: true } };
    },
  };
  return b;
}

async function game(): Promise<GameInput> {
  const background = await scene();
  const sprite = await scene({ x: 0, y: 0, w: 4, h: 4 });
  return {
    id: "g",
    title: "t",
    generalPrompt: "",
    background,
    objects: [{ id: "ball", label: "Ball", prompt: "left", requestedScale: 0.2, sortOrder: 0, image: sprite }],
  };
}

describe("attemptOnce", () => {
  it("never calls vision when nothing changed, and reports every object absent", async () => {
    const g = await game();
    const backend = fake(g.background, () => [{ candidate: 0, objectId: "ball", confidence: 1 }]);
    const out = await attemptOnce(backend, g, []);
    expect(backend.labelCalls).toBe(0);
    expect(out.candidates).toEqual([]);
    expect(out.visionRaw).toBeNull();
    expect(out.result).toEqual({ ok: false, failures: [{ objectId: "ball", class: "absent", detail: expect.any(String) }] });
    expect(out.added).toHaveLength(1);
    expect(out.adjustments).toEqual(out.added);
    expect(out.prompt).toContain("Ball");
  });

  it("passes when the diff finds the pasted region and vision labels it", async () => {
    const g = await game();
    const composed = await scene({ x: 20, y: 20, w: 12, h: 12 });
    const backend = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 0.95 })));
    const out = await attemptOnce(backend, g, []);
    expect(backend.labelCalls).toBe(1);
    expect(out.candidates).toHaveLength(1);
    expect(out.visionRaw).toEqual({ fake: true });
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      const p = out.result.proposals[0];
      expect(p.objectId).toBe("ball");
      expect(p.x).toBeGreaterThan(0.3);
      expect(p.x).toBeLessThan(0.5);
    }
    expect(out.added).toEqual([]);
  });

  it("never calls vision when the whole frame changed, and reports background_altered", async () => {
    const g = await game();
    // A frame that differs from the background everywhere: the model re-rendered the scene.
    const composed = await scene({ x: 0, y: 0, w: SIZE.width, h: SIZE.height });
    const backend = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 1 })));
    const out = await attemptOnce(backend, g, []);
    expect(backend.labelCalls).toBe(0);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.labels).toEqual([]);
    expect(out.visionRaw).toBeNull();
    expect(out.result).toEqual({ ok: false, failures: [{ objectId: null, class: "background_altered", detail: expect.stringContaining("re-rendered") }] });
  });

  it("adds nothing on a repeated identical failure", async () => {
    const g = await game();
    const backend = fake(g.background, () => []);
    const first = await attemptOnce(backend, g, []);
    expect(first.added).toHaveLength(1);
    const second = await attemptOnce(backend, g, first.adjustments);
    expect(second.result.ok).toBe(false);
    expect(second.added).toEqual([]);
    expect(second.adjustments).toEqual(first.adjustments);
    expect(second.prompt).toContain(first.adjustments[0].text);
  });
});
