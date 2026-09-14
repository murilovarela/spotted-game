/**
 * Gemini adapter. Compose: Nano Banana with the background + object images.
 * Label: a vision call constrained to JSON over the candidate crops only.
 */
import { GoogleGenAI, Type } from "@google/genai";
import type { GenerationBackend } from "./backend";
import { dimensions, mimeOf, toPng } from "./images";
import { parseLabels } from "./labels";
import { OUTPUT_ASPECT } from "./types";

export type GeminiConfig = { readonly apiKey: string; readonly imageModel: string; readonly visionModel: string };
/** SDK `ImageConfig`: `aspectRatio` from its documented list, `imageSize` one of "1K" | "2K" | "4K". */
const IMAGE_CONFIG = { aspectRatio: `${OUTPUT_ASPECT.w}:${OUTPUT_ASPECT.h}`, imageSize: "1K" } as const;
export const GEMINI_DEFAULTS = {
  imageModel: "gemini-3.1-flash-image",
  // `gemini-3.1-flash` does not exist as a served id and `gemini-2.5-flash` is retired for new keys (both 404).
  visionModel: "gemini-3.6-flash",
} as const;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
/** Uploads may be PNG, JPEG or WebP: declare what the bytes actually are. */
const inline = (bytes: Uint8Array) => ({ inlineData: { mimeType: mimeOf(bytes) ?? "image/png", data: b64(bytes) } });

export function createGeminiBackend(cfg: GeminiConfig): GenerationBackend {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    name: `gemini:${cfg.imageModel}`,
    async compose(input) {
      const parts = [
        { text: input.prompt },
        { text: "Background image:" },
        inline(input.background),
        ...[...input.objects].sort((a, b) => a.sortOrder - b.sortOrder).flatMap((o, i) => [{ text: `Object ${i + 1} (${o.label}):` }, inline(o.image)]),
      ];
      // One fixed frame regardless of the upload's shape; the prompt tells the model to extend, not stretch.
      const res = await ai.models.generateContent({
        model: cfg.imageModel,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE"], imageConfig: IMAGE_CONFIG },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const data = part?.inlineData?.data;
      if (!data) {
        const block = res.promptFeedback?.blockReason;
        const why = `${res.candidates?.[0]?.finishReason ?? "no candidate"}${block ? `, blocked: ${block}` : ""}`;
        throw new Error(`gemini: no image in response (${why})`);
      }
      // The model may answer in JPEG/WebP; ComposeResult.png is always PNG.
      const bytes = await toPng(new Uint8Array(Buffer.from(data, "base64")));
      // Nano Banana output is not dimensionally guaranteed: read what came back.
      const size = await dimensions(bytes);
      return { png: bytes, ...size };
    },
    async label({ game, scene, candidates, crops }) {
      const objectIds = game.objects.map((o) => o.id);
      const parts = [
        {
          text: [
            "You are labelling candidate regions of a generated hidden-object scene.",
            "First image: the whole scene. Then numbered candidate crops, then the reference images of the objects we placed, each with its id.",
            "For EVERY candidate, decide which object id it shows, or null if it shows none of them. Give a confidence in [0,1].",
            "Return a JSON array of {candidate, objectId, confidence}. Never invent regions.",
          ].join(" "),
        },
        { text: "Scene:" },
        inline(scene.png),
        ...crops.flatMap((c, i) => [{ text: `Candidate ${i}:` }, inline(c)]),
        ...game.objects.flatMap((o) => [{ text: `Object id="${o.id}" label="${o.label}":` }, inline(o.image)]),
      ];
      const res = await ai.models.generateContent({
        model: cfg.visionModel,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                candidate: { type: Type.INTEGER },
                objectId: { type: Type.STRING, nullable: true },
                confidence: { type: Type.NUMBER },
              },
              required: ["candidate", "objectId", "confidence"],
            },
          },
        },
      });
      const text = res.text ?? "";
      return { labels: parseLabels(text, candidates.length, objectIds), raw: { model: cfg.visionModel, text } };
    },
  };
}
