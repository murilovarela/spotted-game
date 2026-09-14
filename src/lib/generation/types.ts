/**
 * Shared shapes for the generation pipeline (SPEC §5.3). Boxes are normalized against
 * the generated image: x/y top-left, w/h as fractions of width/height.
 */
import type { Normalized } from "@/lib/types";

export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
/** A changed region found by the pixel diff. `area` is the box's fraction of the frame. */
export type Candidate = Box & { readonly area: number };
/** One vision assignment: candidate index → object (or null when the region is nothing we asked for). */
export type VisionLabel = { readonly candidate: number; readonly objectId: string | null; readonly confidence: number };
export type Proposal = { readonly objectId: string; readonly x: Normalized; readonly y: Normalized; readonly radius: Normalized };

export const FAILURE_CLASSES = ["absent", "low_confidence", "overlap", "out_of_bounds", "scale", "config", "error", "stale"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type Failure = { readonly objectId: string | null; readonly class: FailureClass; readonly detail: string };
/** A prompt addition for the next attempt; `objectId` null = applies to the whole scene. */
export type Adjustment = { readonly objectId: string | null; readonly text: string };

export type ValidationResult = { readonly ok: true; readonly proposals: readonly Proposal[] } | { readonly ok: false; readonly failures: readonly Failure[] };

export type ObjectInput = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly requestedScale: number | null;
  readonly sortOrder: number;
  readonly image: Uint8Array;
};
export type GameInput = {
  readonly id: string;
  readonly title: string;
  readonly generalPrompt: string;
  readonly background: Uint8Array;
  readonly objects: readonly ObjectInput[];
};
export type ComposeResult = { readonly png: Uint8Array; readonly width: number; readonly height: number };

export const CONFIDENCE_THRESHOLD = 0.6;
export const FRAME_MARGIN = 0.03;
export const MAX_OVERLAP = 0.2;
/** Box area may be within this factor of the requested scale, either way. */
export const SCALE_TOLERANCE = 10;
export const STALE_AFTER_MS = 10 * 60_000;
