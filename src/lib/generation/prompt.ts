/**
 * The compose prompt and the SPEC §5.3 failure → adjustment table. Pure: the prompt is a
 * function of (game, objects, adjustments), so a retry is never a blind retry.
 */
import { type Adjustment, type Failure, OUTPUT_ASPECT } from "./types";

export type PromptObject = { readonly id: string; readonly label: string; readonly prompt: string; readonly requestedScale: number | null; readonly sortOrder: number };
/** Width fraction assumed when no scale is requested: small, as a hidden object should be. */
export const DEFAULT_SCALE = 0.06;

const pct = (scale: number | null) => `${Math.round((scale ?? DEFAULT_SCALE) * 100)}%`;

export function composePrompt(game: { readonly generalPrompt: string }, objects: readonly PromptObject[], adjustments: readonly Adjustment[]): string {
  const sorted = [...objects].sort((a, b) => a.sortOrder - b.sortOrder);
  const lines: string[] = [];
  lines.push("You are compositing objects into a supplied scene for a hidden-object game.");
  lines.push(`Scene: ${game.generalPrompt.trim() || "as supplied"}`);
  lines.push(
    "This image is for a hidden-object game: a player must find each listed object by looking carefully. Every object must be small relative to the frame and hidden in a plausible spot — partly tucked behind or among scene elements, matching the scene's lighting, perspective and scale — but it must remain genuinely findable: fully rendered, recognisable from its reference image, and not covered more than about half.",
  );
  lines.push("The first image is the background. Keep it exactly as supplied: do not move, remove or restyle existing elements. Blend each object in naturally (lighting, shadows, perspective).");
  lines.push(`The output is a ${OUTPUT_ASPECT.w}:${OUTPUT_ASPECT.h} landscape frame. If the supplied background has a different shape, extend the scene naturally to fill the frame; do not crop or stretch it.`);
  lines.push("Objects to place, one per following image, in this order:");
  sorted.forEach((o, i) => {
    const placement = o.prompt.trim() || "placed somewhere plausible";
    const size = o.requestedScale === null ? "" : ` — about ${pct(o.requestedScale)} of the image width`;
    lines.push(`${i + 1}. ${o.label} — ${placement}${size}`);
    for (const a of adjustments) if (a.objectId === o.id) lines.push(`   Adjustment: ${a.text}`);
  });
  lines.push("Rules: no object entirely hidden; no two objects overlapping; nothing touching the frame edges; keep each object recognisable from its reference image.");
  for (const a of adjustments) if (a.objectId === null) lines.push(a.text);
  return lines.join("\n");
}

/** SPEC §5.3 table. Null for failures a prompt cannot fix (config, error, stale). */
export function adjustmentFor(f: Failure, object: PromptObject | null): Adjustment | null {
  const label = object?.label ?? "the object";
  switch (f.class) {
    case "absent": {
      const how = object?.prompt.trim() ? `exactly as described (${object.prompt.trim()})` : "in a plausible spot";
      return { objectId: f.objectId, text: `Place the ${label} ${how}, slightly larger than before and less occluded, so a careful player can find it.` };
    }
    case "low_confidence":
      return { objectId: f.objectId, text: `Show more of the ${label}: at most half of it may be covered.` };
    case "overlap":
      return { objectId: null, text: "Keep every object well separated: at least a fifth of the image apart, none touching." };
    case "out_of_bounds":
      return { objectId: null, text: "Place all objects within the central 80% of the frame, away from every edge." };
    case "background_altered":
      return { objectId: null, text: "Edit the supplied background image in place: keep every existing pixel, colour and element exactly as it is, and change nothing except adding the listed objects." };
    case "scale":
      return { objectId: f.objectId, text: `The ${label} should be roughly ${pct(object?.requestedScale ?? null)} of the image width — about the size of a prominent element of the scene.` };
    case "config":
    case "error":
    case "stale":
      return null;
  }
}

export function mergeAdjustments(prev: readonly Adjustment[], next: readonly Adjustment[]): Adjustment[] {
  const out = [...prev];
  for (const a of next) if (!out.some((p) => p.objectId === a.objectId && p.text === a.text)) out.push(a);
  return out;
}

/** One line per failure: `class: Label — detail`, the shape stored in generation_runs.failure_reason. */
export function formatFailures(failures: readonly Failure[], objects: readonly { readonly id: string; readonly label: string }[]): string {
  return failures
    .map((f) => {
      const label = objects.find((o) => o.id === f.objectId)?.label;
      return label ? `${f.class}: ${label} — ${f.detail}` : `${f.class}: ${f.detail}`;
    })
    .join("\n");
}

export function formatAdjustments(adjs: readonly Adjustment[]): string | null {
  return adjs.length === 0 ? null : adjs.map((a) => a.text).join("\n");
}
