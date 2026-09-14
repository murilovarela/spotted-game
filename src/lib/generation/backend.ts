/** The seam between the pipeline and any image/vision provider. */
import { createGeminiBackend, GEMINI_DEFAULTS } from "./gemini";
import { createPasteBackend } from "./paste";
import type { Box, Candidate, ComposeResult, GameInput, LocateInput, LocateResult, VisionLabel } from "./types";

type ComposeInput = GameInput & {
  readonly prompt: string;
  /** Where the real background lies within `background` (normalized); the rest is letterbox fill. */
  readonly content: Box;
};
export type LabelInput = {
  readonly game: GameInput;
  readonly scene: ComposeResult;
  readonly candidates: readonly Candidate[];
  /** PNG crops of each candidate, same order. */
  readonly crops: readonly Uint8Array[];
};
type LabelResult = { readonly labels: readonly VisionLabel[]; readonly raw: unknown };

export interface GenerationBackend {
  readonly name: string;
  compose(input: ComposeInput): Promise<ComposeResult>;
  label(input: LabelInput): Promise<LabelResult>;
  /**
   * Fallback when the diff cannot see an object (frame re-rendered, or nothing changed
   * where it went): ask where each listed object is. Optional; without it the old
   * failures stand.
   */
  locate?(input: LocateInput): Promise<LocateResult>;
}

export type BackendSelection = { readonly ok: true; readonly backend: GenerationBackend } | { readonly ok: false; readonly reason: string };

/** The env keys the selector reads; `process.env` satisfies it, and tests pass a plain object. */
export type GenerationEnv = Readonly<Record<string, string | undefined>>;

export function backendFromEnv(env: GenerationEnv = process.env): BackendSelection {
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
