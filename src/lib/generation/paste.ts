/**
 * Deterministic compositor (SPEC §7 fallback). Same interface as Gemini; the diff →
 * validate path runs unchanged afterwards, so a validation failure in paste mode is a
 * pipeline bug, not a model quirk.
 */
import type { GenerationBackend } from "./backend";
import { fitRect, outputFrameFor, overlapFraction } from "./boxes";
import { compositePng, dimensions, letterboxTo } from "./images";
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
      // Same shape as the model's output: the background letterboxed into a 4:3 frame, and
      // objects only on the real background, never in the fill bands.
      const size = outputFrameFor(await dimensions(input.background));
      const { png: frame } = await letterboxTo(input.background, size);
      const rect = fitRect(await dimensions(input.background), size);
      const area = { x: rect.x / size.width, y: rect.y / size.height, w: rect.w / size.width, h: rect.h / size.height };
      const sprites = await Promise.all(input.objects.map(async (o) => ({ o, dims: await dimensions(o.image) })));
      const boxes = placeObjects(
        sprites.map(({ o, dims }) => ({ id: o.id, requestedScale: o.requestedScale, aspect: dims.height / dims.width })),
        size,
        input.id,
        { ...PLACEMENT_DEFAULTS, area },
      );
      sprites.forEach(({ o }, i) => placements.set(o.id, boxes[i]));
      const layers = sprites.map(({ o }, i) => ({ png: o.image, box: boxes[i] }));
      return compositePng(frame, layers);
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
