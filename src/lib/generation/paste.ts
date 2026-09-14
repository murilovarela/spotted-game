/**
 * Deterministic compositor (SPEC §7 fallback). Same interface as Gemini; the diff →
 * validate path runs unchanged afterwards, so a validation failure in paste mode is a
 * pipeline bug, not a model quirk.
 */
import type { GenerationBackend } from "./backend";
import { overlapFraction } from "./boxes";
import { compositePng, dimensions } from "./images";
import { placeObjects, PLACEMENT_DEFAULTS } from "./placement";
import type { Box } from "./types";

export function createPasteBackend(): GenerationBackend {
  const placements = new Map<string, Box>(); // objectId → box, from the last compose that placed it
  const known = (objects: readonly { readonly id: string }[]) =>
    objects.flatMap((o) => {
      const box = placements.get(o.id);
      return box ? [{ objectId: o.id, box }] : [];
    });
  return {
    name: "paste",
    async compose(input) {
      // The background arrives already letterboxed into the 4:3 frame (attempt.ts); objects go
      // only on the real background (`content`), never in the fill bands.
      const size = await dimensions(input.background);
      const sprites = await Promise.all(input.objects.map(async (o) => ({ o, dims: await dimensions(o.image) })));
      const boxes = placeObjects(
        sprites.map(({ o, dims }) => ({ id: o.id, requestedScale: o.requestedScale, aspect: dims.height / dims.width })),
        size,
        input.id,
        { ...PLACEMENT_DEFAULTS, area: input.content },
      );
      sprites.forEach(({ o }, i) => placements.set(o.id, boxes[i]));
      const layers = sprites.map(({ o }, i) => ({ png: o.image, box: boxes[i] }));
      return compositePng(input.background, layers);
    },
    async label({ game, candidates }) {
      const labels = known(game.objects).flatMap(({ objectId, box }) => {
        let best = -1;
        let bestOverlap = 0;
        candidates.forEach((c, i) => {
          const f = overlapFraction(c, box);
          if (f > bestOverlap) {
            bestOverlap = f;
            best = i;
          }
        });
        return best === -1 ? [] : [{ candidate: best, objectId, confidence: 1 }];
      });
      return { labels, raw: { backend: "paste", placements: Object.fromEntries(known(game.objects).map((k) => [k.objectId, k.box])) } };
    },
    async locate({ objects }) {
      const boxes = known(objects).map((k) => ({ ...k, confidence: 1 }));
      return { boxes, raw: { backend: "paste", located: boxes.map((b) => b.objectId) } };
    },
  };
}
