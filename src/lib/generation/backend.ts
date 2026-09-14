/** The seam between the pipeline and any image/vision provider. */
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

// `backendFromEnv` is added in Task 5 once the Gemini backend exists (it needs both).
