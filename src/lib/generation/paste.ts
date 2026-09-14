/**
 * Deterministic compositor (SPEC §7 fallback). Same interface as Gemini; the diff →
 * validate path runs unchanged afterwards, so a validation failure in paste mode is a
 * pipeline bug, not a model quirk.
 */
import type { GenerationBackend } from "./backend";
import { overlapFraction } from "./boxes";
import { compositePng, dimensions } from "./images";
import { placeObjects } from "./placement";
import type { Box } from "./types";

export function createPasteBackend(): GenerationBackend {
  const placements = new Map<string, Map<string, Box>>(); // gameId → objectId → box
  return {
    name: "paste",
    async compose(input) {
      const size = await dimensions(input.background);
      const sprites = await Promise.all(input.objects.map(async (o) => ({ o, dims: await dimensions(o.image) })));
      const boxes = placeObjects(
        sprites.map(({ o, dims }) => ({ id: o.id, requestedScale: o.requestedScale, aspect: dims.height / dims.width })),
        size,
        input.id,
      );
      placements.set(input.id, new Map(sprites.map(({ o }, i) => [o.id, boxes[i]])));
      const layers = sprites.map(({ o }, i) => ({ png: o.image, box: boxes[i] }));
      return compositePng(input.background, layers);
    },
    async label({ game, candidates }) {
      const boxes = placements.get(game.id) ?? new Map<string, Box>();
      const labels = game.objects.flatMap((o) => {
        const box = boxes.get(o.id);
        if (!box) return [];
        let best = -1;
        let bestOverlap = 0;
        candidates.forEach((c, i) => {
          const f = overlapFraction(c, box);
          if (f > bestOverlap) {
            bestOverlap = f;
            best = i;
          }
        });
        return best === -1 ? [] : [{ candidate: best, objectId: o.id, confidence: 1 }];
      });
      return { labels, raw: { backend: "paste", placements: Object.fromEntries(boxes) } };
    },
  };
}
