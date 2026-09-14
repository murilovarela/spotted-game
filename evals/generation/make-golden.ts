/**
 * One-off: builds the golden set with Gemini text-to-image (5 scenes + 10 object sprites =
 * 15 generations), downscales with sharp, and writes case folders. Skips any image that
 * already exists, so a partial run can be resumed without paying twice. Never CI.
 */
import { GoogleGenAI } from "@google/genai";
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { GEMINI_DEFAULTS } from "@/lib/generation/gemini";

loadEnvConfig(process.cwd());

const root = join(process.cwd(), "evals/generation/golden");
// Photographic PNGs at 1024 on the long side land at 1.8–2.2 MB; 896 keeps every scene under the 1.5 MB cap in true colour.
const SCENE_MAX_SIDE = 896;
const OBJECT_MAX_SIDE = 256;

type ObjectSpec = { readonly key: string; readonly label: string; readonly subject: string };
const OBJECTS: readonly ObjectSpec[] = [
  { key: "mug", label: "Coffee mug", subject: "white ceramic coffee mug" },
  { key: "duck", label: "Rubber duck", subject: "yellow rubber duck" },
  { key: "apple", label: "Red apple", subject: "red apple" },
  { key: "tennis-ball", label: "Tennis ball", subject: "tennis ball" },
  { key: "sneaker", label: "Blue sneaker", subject: "blue sneaker" },
  { key: "watch", label: "Wristwatch", subject: "wristwatch with a leather strap" },
  { key: "toy-car", label: "Toy car", subject: "small red toy car" },
  { key: "sunglasses", label: "Sunglasses", subject: "pair of black sunglasses" },
  { key: "teddy", label: "Teddy bear", subject: "brown teddy bear" },
  { key: "bottle", label: "Green bottle", subject: "green glass bottle" },
];

type Placement = { readonly object: string; readonly prompt: string; readonly requestedScale: number };
type CaseSpec = { readonly dir: string; readonly title: string; readonly scene: string; readonly generalPrompt: string; readonly objects: readonly Placement[] };
const CASES: readonly CaseSpec[] = [
  {
    dir: "kitchen-counter",
    title: "Kitchen counter",
    scene: "a kitchen counter with a sink, a kettle, a cutting board and some jars",
    generalPrompt: "A bright home kitchen counter, medium difficulty.",
    objects: [
      { object: "mug", prompt: "on the counter next to the kettle", requestedScale: 0.1 },
      { object: "apple", prompt: "on the cutting board", requestedScale: 0.08 },
      { object: "bottle", prompt: "standing at the back of the counter against the wall", requestedScale: 0.1 },
    ],
  },
  {
    dir: "park-bench",
    title: "Park bench",
    scene: "a wooden park bench on a gravel path with grass, bushes and trees behind it",
    generalPrompt: "A quiet park with a wooden bench, medium difficulty.",
    objects: [
      { object: "duck", prompt: "sitting on the bench seat", requestedScale: 0.08 },
      { object: "tennis-ball", prompt: "on the path near a bench leg", requestedScale: 0.08 },
    ],
  },
  {
    dir: "cluttered-desk",
    title: "Cluttered desk",
    scene: "a cluttered home office desk with a monitor, keyboard, notebooks, pens and a lamp",
    generalPrompt: "A cluttered home office desk, hard difficulty.",
    objects: [
      { object: "watch", prompt: "lying flat on the desk beside the keyboard", requestedScale: 0.1 },
      { object: "toy-car", prompt: "on the desk in front of the monitor", requestedScale: 0.1 },
      { object: "sunglasses", prompt: "folded on top of a notebook", requestedScale: 0.12 },
    ],
  },
  {
    dir: "beach-towel",
    title: "Beach towel",
    scene: "a striped beach towel spread on sand with a beach bag and a bit of sea in the background",
    generalPrompt: "A sunny beach with a towel on the sand, easy difficulty.",
    objects: [
      { object: "teddy", prompt: "sitting on the towel", requestedScale: 0.12 },
      { object: "sneaker", prompt: "on the sand beside the towel", requestedScale: 0.1 },
    ],
  },
  {
    dir: "garage-workshop",
    title: "Garage workshop",
    scene: "a garage workshop with a workbench, tools on a pegboard, shelves and a toolbox",
    generalPrompt: "A garage workshop with a workbench, hard difficulty.",
    objects: [
      { object: "toy-car", prompt: "on the workbench", requestedScale: 0.1 },
      { object: "mug", prompt: "on a shelf", requestedScale: 0.08 },
    ],
  },
];

const scenePrompt = (scene: string) => `${scene}; photorealistic, natural light, no people, wide shot`;
const objectPrompt = (subject: string) => `a single ${subject}, centered, on a plain white background, product photo, no shadow`;

function client(): { ai: GoogleGenAI; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return { ai: new GoogleGenAI({ apiKey }), model: process.env.GEMINI_IMAGE_MODEL ?? GEMINI_DEFAULTS.imageModel };
}

async function generate(prompt: string, aspectRatio: string): Promise<Uint8Array> {
  const { ai, model } = client();
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
  });
  const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!data) throw new Error(`no image for "${prompt}" (${res.candidates?.[0]?.finishReason ?? "no candidate"})`);
  return new Uint8Array(Buffer.from(data, "base64"));
}

async function downscale(bytes: Uint8Array, maxSide: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
}

async function main(): Promise<void> {
  let calls = 0;
  for (const c of CASES) {
    const dir = join(root, c.dir);
    mkdirSync(join(dir, "objects"), { recursive: true });
    const bg = join(dir, "background.png");
    if (existsSync(bg)) {
      console.log(`skip  ${c.dir}/background.png`);
    } else {
      calls++;
      writeFileSync(bg, await downscale(await generate(scenePrompt(c.scene), "4:3"), SCENE_MAX_SIDE));
      console.log(`wrote ${c.dir}/background.png`);
    }
  }

  for (const o of OBJECTS) {
    const targets = CASES.filter((c) => c.objects.some((p) => p.object === o.key)).map((c) => join(root, c.dir, "objects", `${o.key}.png`));
    if (targets.length === 0) throw new Error(`object ${o.key} is unused`);
    if (targets.every((t) => existsSync(t))) {
      console.log(`skip  objects/${o.key}.png`);
      continue;
    }
    calls++;
    const png = await downscale(await generate(objectPrompt(o.subject), "1:1"), OBJECT_MAX_SIDE);
    for (const t of targets) writeFileSync(t, png);
    console.log(`wrote objects/${o.key}.png → ${targets.length} case(s)`);
  }

  for (const c of CASES) {
    const spec = {
      title: c.title,
      generalPrompt: c.generalPrompt,
      objects: c.objects.map((p) => {
        const o = OBJECTS.find((x) => x.key === p.object);
        if (!o) throw new Error(`unknown object ${p.object}`);
        return { file: `objects/${o.key}.png`, label: o.label, prompt: p.prompt, requestedScale: p.requestedScale };
      }),
    };
    writeFileSync(join(root, c.dir, "case.json"), `${JSON.stringify(spec, null, 2)}\n`);
  }
  console.log(`done: ${calls} image generation(s)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
