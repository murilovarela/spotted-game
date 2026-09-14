/** Parses the vision model's JSON (labels or locations); tolerant of fences and wrappers, strict on shape. */
import type { Location, VisionLabel } from "./types";

/** The array in a JSON payload: bare, or under `key`; [] when it is neither. */
function jsonArray(text: string, key: string): unknown[] {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  const arr: unknown = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[key] : undefined;
  return Array.isArray(arr) ? arr : [];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function parseLabels(text: string, candidateCount: number, objectIds: readonly string[]): VisionLabel[] {
  const known = new Set(objectIds);
  const out: VisionLabel[] = [];
  for (const item of jsonArray(text, "labels")) {
    if (typeof item !== "object" || item === null) continue;
    const { candidate, objectId, confidence } = item as { candidate?: unknown; objectId?: unknown; confidence?: unknown };
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0 || candidate >= candidateCount) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    const id = typeof objectId === "string" && known.has(objectId) ? objectId : null;
    out.push({ candidate, objectId: id, confidence: clamp01(confidence) });
  }
  return out;
}

/**
 * The documented Gemini object-localisation shape: `box_2d` = [ymin, xmin, ymax, xmax] on a
 * 0–1000 grid. Coordinates are clamped to the frame; entries for unknown objects, malformed
 * boxes or empty boxes are dropped.
 */
export function parseLocations(text: string, objectIds: readonly string[]): Location[] {
  const known = new Set(objectIds);
  const out: Location[] = [];
  for (const item of jsonArray(text, "locations")) {
    if (typeof item !== "object" || item === null) continue;
    const { objectId, box_2d: box, confidence } = item as { objectId?: unknown; box_2d?: unknown; confidence?: unknown };
    if (typeof objectId !== "string" || !known.has(objectId)) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((n): n is number => typeof n === "number" && Number.isFinite(n))) continue;
    // Clamp on the grid and divide once, so w/h are exact for whole-number inputs.
    const [ymin, xmin, ymax, xmax] = box.map((n) => Math.min(1000, Math.max(0, n)));
    if (xmax <= xmin || ymax <= ymin) continue;
    out.push({ objectId, box: { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 }, confidence: clamp01(confidence) });
  }
  return out;
}
