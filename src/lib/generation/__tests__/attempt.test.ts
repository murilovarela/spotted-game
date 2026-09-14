import { describe, expect, it } from "vitest";
import { attemptOnce } from "../attempt";
import type { GenerationBackend, LabelInput } from "../backend";
import { decodeRGBA, dimensions, encodePng, letterboxTo } from "../images";
import type { GameInput, LocateInput, Location, VisionLabel } from "../types";

const SIZE = { width: 64, height: 64 };

async function scene(rect?: { x: number; y: number; w: number; h: number }): Promise<Uint8Array> {
  const data = new Uint8Array(SIZE.width * SIZE.height * 4);
  for (let i = 0; i < SIZE.width * SIZE.height; i++) data.set([120, 120, 120, 255], i * 4);
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) data.set([255, 0, 0, 255], (y * SIZE.width + x) * 4);
  }
  return encodePng(data, SIZE);
}

type Fake = GenerationBackend & { labelCalls: number; locateCalls: string[][] };

function fake(composed: Uint8Array, labels: (input: LabelInput) => VisionLabel[], locate?: (input: LocateInput) => Location[]): Fake {
  const b: Fake = {
    name: "fake",
    labelCalls: 0,
    locateCalls: [],
    compose: async () => ({ png: composed, ...SIZE }),
    label: async (input: LabelInput) => {
      b.labelCalls++;
      return { labels: labels(input), raw: { fake: true } };
    },
    ...(locate
      ? {
          locate: async (input: LocateInput) => {
            b.locateCalls.push(input.objects.map((o) => o.id));
            return { boxes: locate(input), raw: { located: true } };
          },
        }
      : {}),
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
    expect(out.visionRaw).toEqual({ diffCover: 0, contentFraction: expect.any(Number), labels: null, locate: null });
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
    expect(out.candidates[0].source).toBe("diff");
    const raw = out.visionRaw as { diffCover: number; contentFraction: number };
    expect(raw.diffCover).toBeCloseTo(out.candidates[0].area / raw.contentFraction, 10);
    expect(out.visionRaw).toMatchObject({ labels: { fake: true }, locate: null });
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      const p = out.result.proposals[0];
      expect(p.objectId).toBe("ball");
      expect(p.x).toBeGreaterThan(0.3);
      expect(p.x).toBeLessThan(0.5);
    }
    expect(out.added).toEqual([]);
  });

  it("without locate: never labels a re-rendered frame, and reports background_altered", async () => {
    const g = await game();
    // A frame that differs from the background everywhere: the model re-rendered the scene.
    const composed = await scene({ x: 0, y: 0, w: SIZE.width, h: SIZE.height });
    const backend = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 1 })));
    const out = await attemptOnce(backend, g, []);
    expect(backend.labelCalls).toBe(0);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.labels).toEqual([]);
    // Cover is relative to the (inset) mask, so a whole-frame change is 100% of the content.
    expect(out.visionRaw).toEqual({ diffCover: expect.closeTo(1, 5), contentFraction: expect.closeTo(0.82, 1), labels: null, locate: null });
    expect(out.result).toEqual({ ok: false, failures: [{ objectId: null, class: "background_altered", detail: expect.stringContaining("re-rendered") }] });
  });

  it("with an unusable diff: asks vision to locate every object, and validates those boxes", async () => {
    const g = await game();
    const composed = await scene({ x: 0, y: 0, w: SIZE.width, h: SIZE.height });
    const backend = fake(
      composed,
      () => [],
      () => [{ objectId: "ball", box: { x: 0.3, y: 0.4, w: 0.1, h: 0.1 }, confidence: 0.9 }],
    );
    const out = await attemptOnce(backend, g, []);
    expect(backend.labelCalls).toBe(0);
    expect(backend.locateCalls).toEqual([["ball"]]);
    const vision = out.candidates.filter((c) => c.source === "vision");
    expect(vision).toEqual([{ x: 0.3, y: 0.4, w: 0.1, h: 0.1, area: expect.closeTo(0.01, 10), source: "vision" }]);
    expect(out.labels).toEqual([{ candidate: out.candidates.length - 1, objectId: "ball", confidence: 0.9 }]);
    expect(out.visionRaw).toEqual({ diffCover: expect.closeTo(1, 5), contentFraction: expect.closeTo(0.82, 1), labels: null, locate: { located: true } });
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.proposals[0]).toMatchObject({ objectId: "ball", x: 0.35, y: 0.45 });
  });

  it("with an unusable diff and nothing located: reports background_altered", async () => {
    const g = await game();
    const composed = await scene({ x: 0, y: 0, w: SIZE.width, h: SIZE.height });
    const backend = fake(composed, () => [], () => []);
    const out = await attemptOnce(backend, g, []);
    expect(backend.locateCalls).toEqual([["ball"]]);
    expect(out.result).toEqual({ ok: false, failures: [{ objectId: null, class: "background_altered", detail: expect.stringContaining("re-rendered") }] });
  });

  it("when the diff finds one object of two: locates only the missing one", async () => {
    const g = await game();
    const two: GameInput = { ...g, objects: [...g.objects, { id: "cube", label: "Cube", prompt: "", requestedScale: null, sortOrder: 1, image: g.objects[0].image }] };
    const composed = await scene({ x: 20, y: 20, w: 12, h: 12 });
    const backend = fake(
      composed,
      ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 0.95 })),
      () => [{ objectId: "cube", box: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, confidence: 0.8 }],
    );
    const out = await attemptOnce(backend, two, []);
    expect(backend.labelCalls).toBe(1);
    expect(backend.locateCalls).toEqual([["cube"]]);
    expect(out.candidates.map((c) => c.source)).toEqual(["diff", "vision"]);
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.proposals.map((p) => p.objectId)).toEqual(["ball", "cube"]);
    // Located for an object we did not ask about: ignored.
    const stray = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 0.95 })), () => [{ objectId: "ball", box: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, confidence: 1 }]);
    const missing = await attemptOnce(stray, two, []);
    expect(missing.candidates.map((c) => c.source)).toEqual(["diff"]);
    expect(missing.result).toEqual({ ok: false, failures: [{ objectId: "cube", class: "absent", detail: expect.any(String) }] });
  });

  it("does not locate when every object already has a label", async () => {
    const g = await game();
    const composed = await scene({ x: 20, y: 20, w: 12, h: 12 });
    const backend = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 0.3 })), () => []);
    const out = await attemptOnce(backend, g, []);
    expect(backend.locateCalls).toEqual([]);
    expect(out.result).toEqual({ ok: false, failures: [{ objectId: "ball", class: "low_confidence", detail: expect.any(String) }] });
  });

  it("diffs against the background letterboxed into the output frame: changes in the fill bands are not candidates", async () => {
    const g = await game();
    // A 48×64 portrait background; the model answers a 64×48 landscape frame with the background
    // centred (columns 14..49) and something new painted in the left band only.
    const portrait = await encodePng(new Uint8Array(48 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120)), { width: 48, height: 64 });
    const frame = { width: 64, height: 48 };
    const { png: boxed } = await letterboxTo(portrait, frame);
    const rgba = await decodeRGBA(boxed);
    for (let y = 10; y < 40; y++) for (let x = 2; x < 10; x++) rgba.data.set([255, 0, 0, 255], (y * 64 + x) * 4);
    const composed = await encodePng(rgba.data, frame);
    const backend = fake(composed, ({ candidates }) => candidates.map((_, i) => ({ candidate: i, objectId: "ball", confidence: 1 })));
    backend.compose = async () => ({ png: composed, ...frame });
    const out = await attemptOnce(backend, { ...g, background: portrait }, []);
    expect(out.candidates).toEqual([]);
    expect(backend.labelCalls).toBe(0);
    expect(out.result.ok).toBe(false);
    // The same paint inside the real background is a candidate.
    const inside = await decodeRGBA(boxed);
    for (let y = 10; y < 40; y++) for (let x = 20; x < 28; x++) inside.data.set([255, 0, 0, 255], (y * 64 + x) * 4);
    const composedInside = await encodePng(inside.data, frame);
    backend.compose = async () => ({ png: composedInside, ...frame });
    const found = await attemptOnce(backend, { ...g, background: portrait }, []);
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0].x).toBeGreaterThan(0.25);
  });

  it("sends the model the background letterboxed to 4:3, bounded, and explains the bands only when there are any", async () => {
    const g = await game();
    const portrait = await encodePng(new Uint8Array(48 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120)), { width: 48, height: 64 });
    const seen: { size: { width: number; height: number }; prompt: string; content: unknown }[] = [];
    const backend = fake(g.background, () => []);
    backend.compose = async (input) => {
      seen.push({ size: await dimensions(input.background), prompt: input.prompt, content: input.content });
      return { png: g.background, ...SIZE };
    };
    await attemptOnce(backend, { ...g, background: portrait }, []);
    expect(seen[0].size).toEqual({ width: 86, height: 64 }); // ceil(64 × 4/3)
    expect(seen[0].prompt).toContain("The flat grey bands at the edges are empty space");
    expect(seen[0].content).toEqual({ x: 19 / 86, y: 0, w: 48 / 86, h: 1 });
    const landscape = await encodePng(new Uint8Array(64 * 48 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120)), { width: 64, height: 48 });
    await attemptOnce(backend, { ...g, background: landscape }, []);
    expect(seen[1].size).toEqual({ width: 64, height: 48 });
    expect(seen[1].prompt).not.toContain("flat grey bands");
    expect(seen[1].content).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // A large upload is still bounded after letterboxing.
    const big = await encodePng(new Uint8Array(1800 * 1000 * 4).fill(90), { width: 1800, height: 1000 });
    await attemptOnce(backend, { ...g, background: big }, []);
    expect(seen[2].size).toEqual({ width: 1536, height: 1152 });
  });

  it("measures the diff cover over the real content, so a re-rendered portrait area triggers the fallback", async () => {
    const g = await game();
    // 48×64 portrait → the frame's content share is 0.75 of the width; paint the whole content column.
    const portrait = await encodePng(new Uint8Array(48 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120)), { width: 48, height: 64 });
    const frame = { width: 64, height: 48 };
    const { png: boxed } = await letterboxTo(portrait, frame);
    const rgba = await decodeRGBA(boxed);
    for (let y = 0; y < 48; y++) for (let x = 14; x < 50; x++) rgba.data.set([255, 0, 0, 255], (y * 64 + x) * 4);
    const composed = await encodePng(rgba.data, frame);
    const backend = fake(composed, () => [], () => [{ objectId: "ball", box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, confidence: 0.9 }]);
    backend.compose = async () => ({ png: composed, ...frame });
    const out = await attemptOnce(backend, { ...g, background: portrait }, []);
    const raw = out.visionRaw as { diffCover: number; contentFraction: number };
    expect(raw.contentFraction).toBeLessThan(0.6);
    expect(raw.diffCover).toBeGreaterThan(0.6); // of the content, although well under 60% of the frame
    expect(backend.labelCalls).toBe(0);
    expect(backend.locateCalls).toEqual([["ball"]]);
    expect(out.result.ok).toBe(true);
  });

  it("treats a frame with no comparable pixels as an unusable diff and goes straight to locate", async () => {
    const g = await game();
    // 4×4 frames: the 3px blur inset leaves no mask pixel at all.
    const tiny = await encodePng(new Uint8Array(4 * 4 * 4).fill(120), { width: 4, height: 4 });
    const backend = fake(tiny, () => [], () => [{ objectId: "ball", box: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, confidence: 0.9 }]);
    backend.compose = async () => ({ png: tiny, width: 4, height: 4 });
    const out = await attemptOnce(backend, { ...g, background: tiny }, []);
    const raw = out.visionRaw as { diffCover: number; contentFraction: number };
    expect(raw.contentFraction).toBe(0);
    expect(raw.diffCover).toBe(Number.POSITIVE_INFINITY);
    expect(backend.labelCalls).toBe(0);
    expect(backend.locateCalls).toEqual([["ball"]]);
    expect(out.result.ok).toBe(true);
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
