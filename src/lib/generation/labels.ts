/** Parses the vision model's JSON into VisionLabel[]; tolerant of fences and wrappers, strict on shape. */
import type { VisionLabel } from "./types";

export function parseLabels(text: string, candidateCount: number, objectIds: readonly string[]): VisionLabel[] {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  const arr: unknown = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? (parsed as { labels?: unknown }).labels : undefined;
  if (!Array.isArray(arr)) return [];
  const known = new Set(objectIds);
  const out: VisionLabel[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const { candidate, objectId, confidence } = item as { candidate?: unknown; objectId?: unknown; confidence?: unknown };
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0 || candidate >= candidateCount) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    const id = typeof objectId === "string" && known.has(objectId) ? objectId : null;
    out.push({ candidate, objectId: id, confidence: Math.min(1, Math.max(0, confidence)) });
  }
  return out;
}
