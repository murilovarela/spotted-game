/** The seam between the pipeline and any image/vision provider. */
import { createGeminiBackend, GEMINI_DEFAULTS } from "./gemini";
import { createPasteBackend } from "./paste";
import type { Candidate, ComposeResult, GameInput, VisionLabel } from "./types";

export type ComposeInput = GameInput & { readonly prompt: string };
export type LabelInput = {
  readonly game: GameInput;
  readonly scene: ComposeResult;
  readonly candidates: readonly Candidate[];
  /** PNG crops of each candidate, same order. */
  readonly crops: readonly Uint8Array[];
};
export type LabelResult = { readonly labels: readonly VisionLabel[]; readonly raw: unknown };

export interface GenerationBackend {
  readonly name: string;
  compose(input: ComposeInput): Promise<ComposeResult>;
  label(input: LabelInput): Promise<LabelResult>;
}

export type BackendSelection = { readonly ok: true; readonly backend: GenerationBackend } | { readonly ok: false; readonly reason: string };

export function backendFromEnv(env: NodeJS.ProcessEnv = process.env): BackendSelection {
  const mode = env.GENERATION_MODE ?? "gemini";
  if (mode === "paste") return { ok: true, backend: createPasteBackend() };
  if (mode !== "gemini") return { ok: false, reason: `config: GENERATION_MODE must be gemini or paste, got "${mode}"` };
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "config: GEMINI_API_KEY not set" };
  return {
    ok: true,
    backend: createGeminiBackend({ apiKey, imageModel: env.GEMINI_IMAGE_MODEL ?? GEMINI_DEFAULTS.imageModel, visionModel: env.GEMINI_VISION_MODEL ?? GEMINI_DEFAULTS.visionModel }),
  };
}
