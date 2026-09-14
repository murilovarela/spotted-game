# Generation eval

A five-case golden set and a harness that runs the SPEC §5.3 pipeline
(compose → pixel diff → vision labelling → validate → adjust and retry, max 3) over it and
reports a pass rate.

## The golden set

`golden/<case>/` holds a photographic `background.png` (896 px on the long side), the
object sprites under `objects/`, and a `case.json`:

```json
{
  "title": "Kitchen counter",
  "generalPrompt": "A bright home kitchen counter, medium difficulty.",
  "objects": [
    { "file": "objects/mug.png", "label": "Coffee mug", "prompt": "on the counter next to the kettle", "requestedScale": 0.1 }
  ]
}
```

Cases: kitchen counter, park bench, cluttered desk, beach towel, garage workshop — two or
three objects each, drawn from ten sprites (mug, rubber duck, red apple, tennis ball, blue
sneaker, wristwatch, toy car, sunglasses, teddy bear, green bottle). Two scenes already
contain a mug, which is deliberate: the diff step must stop vision from "finding" it.

### How it was made

`npm run eval:make-golden` generated every image with Gemini text-to-image (the image model
from `GEMINI_IMAGE_MODEL`, default in `src/lib/generation/gemini.ts`): scene prompts of the
form "<scene>; photorealistic, natural light, no people, wide shot" and object prompts
"a single <object>, centered, on a plain white background, product photo, no shadow".
Sharp downscales scenes to 896 px and sprites to 256 px. The script skips files that
already exist, so re-running it costs nothing unless something is missing. Fifteen
generations were paid for once; the PNGs are committed.

## Running the eval

```
npm run eval:generation -- --backend paste      # deterministic compositor, free, should be 5/5
npm run eval:generation                         # real Gemini: ≤ 15 image + ≤ 15 vision calls
npm run eval:generation -- --threshold 0.6 --out /tmp/eval-run
```

`--out <dir>` writes every generated scene (`<case>-attempt-N.png`) and a per-case JSON
trace (prompt, candidates, labels, failures, adjustments; no image data). The process exits
1 when the pass rate is below `--threshold` (default 0.8).

The Gemini run costs money and takes about a minute per case. It runs on demand only and
never in CI; CI exercises the pipeline through the paste backend.
