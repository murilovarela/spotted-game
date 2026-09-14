# Phase 2 — Image generation pipeline: design

Approved in chat 2026-09-14. Argues from `docs/SPEC.md` §5.3, §5.4, §6.4–6.5, §8 and
`docs/handoffs/phase-3.md`. Stream B (imagegen): `src/lib/generation/**`,
`evals/generation/**`; integration point: a Generation panel on the master edit page.

## Decisions

| Question | Choice | Alternatives rejected |
| --- | --- | --- |
| Job runner | Next `after()` inside a server action; page segment `maxDuration = 300`; polling via server action + `router.refresh()` | Vercel Queues/Inngest (vendor for durability we don't need); step-per-request (loop leaks into HTTP) |
| Paste fallback | Full stand-in: composites, then runs the same diff → validate path | Minimal compositor that skips validation |
| Golden set | Gemini-made scenes/objects generated once, committed | Own photos; seed fixtures only |
| Gemini access | Real key during build; eval on demand; CI never calls Gemini (`GENERATION_MODE=paste`) | — |
| Route handler | None — `src/app/api/generate` stays empty (CLAUDE.md: actions over routes) | POST + GET polling route |

## Modules (`src/lib/generation/`)

| File | Pure? | Responsibility |
| --- | --- | --- |
| `types.ts` | — | `Candidate {x,y,w,h,area}` (normalized), `VisionLabel {candidate, objectId, confidence}`, `Proposal`, `FailureClass = background_altered \| absent \| low_confidence \| overlap \| out_of_bounds \| scale \| config \| error \| stale`, `Failure {objectId, class, detail}`, `AttemptOutcome` |
| `prompt.ts` | yes | `composePrompt(game, objects, adjustments)`; `adjustmentFor(failure, object)` per SPEC §5.3 table |
| `diff.ts` | yes | `diffRegions(bg, gen, w, h, opts = DIFF_DEFAULTS) → Candidate[]` over RGBA `Uint8Array` |
| `validate.ts` | yes | SPEC predicate → `{ok:true, proposals} \| {ok:false, failures}` |
| `boxes.ts` | yes | box→circle (aspect-aware radius in width units), overlap fraction, margin test, scale ratio |
| `status.ts` | yes | `deriveGenerationState(runs, now)` → `idle \| running \| passed \| failed{reason, attempts}`; `running` > 10 min ⇒ `failed: stale` |
| `images.ts` | sharp | decode→RGBA, resize to dims, downscale for diff (longest side ≤ 512), bound backend inputs (`downscale`: background ≤ 1536, object images ≤ 512 on the long side), crop, encode PNG |
| `backend.ts` | — | `GenerationBackend { compose(input) → {png, width, height}; label(scene, candidates, objects) → VisionLabel[] }`; `backendFromEnv()` |
| `gemini.ts` | I/O | `@google/genai`; `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-image`), `GEMINI_VISION_MODEL` (default `gemini-3.1-flash`); JSON-schema vision output |
| `paste.ts` | placement pure, composite sharp | seeded PRNG by `gameId`; margin 10 %; no overlap; width = `(requestedScale ?? 0.12) × W`; `label` = known boxes, confidence 1 |
| `attempt.ts` | I/O-free given a backend | `attemptOnce(backend, input, adjustments) → AttemptOutcome` — bound inputs, compose, diff, label (skipped when the changed regions exceed 60 % of the frame), validate; used by `run.ts` and the eval |
| `run.ts` | DB | `runGeneration(db, gameId, backend, deps)` — the loop, persists every attempt, `setGeneratedImage` on pass |
| `actions.ts` | server | `startGenerationAction(gameId)`, `getGenerationStateAction(gameId)` |

## The loop

Per request, at most `MAX_GENERATION_ATTEMPTS` (3). For each attempt: insert
`generation_runs` (`running`, `promptUsed`, `attemptNumber = max + 1` for the game — numbering
continues across requests; the cap is per request) → compose → `putObject` to
`games/<id>/generated/<nanoid>.png`, read actual output dims → resize background to those
dims → `diffRegions` → objects with no candidate are `absent` before vision is called →
`label` (raw response persisted in `visionResponse`) → `validate`. Pass: row `passed`,
`setGeneratedImage(db, gameId, {key, width, height}, proposals)`, stop. Fail: row `failed`
with `failureReason` = one line per failure (`class: <label> — detail`) and `adjustment` =
the adjustments added for the next attempt; continue — unless the attempt added no new
adjustment, in which case the prompt would be unchanged, the row gets
`no new adjustment; not retrying` appended to its reason and the loop stops (a blind retry
is not a recovery loop). Inputs handed to the backend are bounded first: background ≤ 1536,
object images ≤ 512 on the long side; the diff still runs against the original background,
so coordinates stay normalized against the generated image. Every thrown error inside the loop is
caught and recorded on the current row (`failureReason: "error: …"`) — an unrecorded
attempt did not happen. After the cap the state is `failed` with the last reason; the
master edits prompts and starts a new request.

Trigger: `startGenerationAction` — owner, draft, `backgroundKey` set, ≥1 object, and no
`running` run younger than 10 min, checked in a transaction with the game row `FOR UPDATE`;
the first attempt row is inserted in that transaction (`queued`) so a double click cannot
start two loops. Then `after(() => runGeneration(...))`; returns `{ attemptNumber }`.

## Pixel diff (deterministic)

Both images at the generated dims, downscaled to longest side ≤ 512. Mask = max channel
|Δ| > 40. Two 3×3 dilations. 8-connected components (flood fill) → boxes; drop < 0.05 % of
frame; merge boxes overlapping or within 2 %; keep the largest `2N`. Return normalized
boxes. Tunables in `DIFF_DEFAULTS`.

## Vision

One call: generated image + numbered candidate crops + named object thumbnails; response
constrained to `[{candidate, objectId | null, confidence}]`. Vision never searches the
frame. Threshold 0.6.

## Validation (SPEC §5.3, in order per object)

Scene-level first: when the merged candidates cover more than 60 % of the frame the
background was re-rendered (`background_altered`) and that single failure replaces the
per-object checks; vision is not called for such a frame. Then, per object:
exactly one matched candidate (`absent`; a second match is dropped as a decoy) →
`low_confidence` < 0.6 → box inside frame and outside the 3 % margin (`out_of_bounds`) →
pairwise overlap ≤ 20 % of the smaller box (`overlap`) → when `requestedScale` is set, box
area within 10× either way of `requestedScale²` (`scale`). Proposal circle: box centre,
`radius = max(w, h·H/W) / 2` in width units.

## Adjustments (SPEC §5.3 table)

`background_altered` → edit the supplied image in place, change nothing but the added
objects; `absent` → restate placement explicitly, "clearly visible, larger"; `low_confidence` →
"not occluded, fully in view"; `overlap` → "well separated, at least a fifth of the image
apart"; `out_of_bounds` → "central 80 % of the frame"; `scale` → pin size relative to a
named background element and "roughly X % of the image width". Adjustments accumulate per
object; the prompt is a pure function of (game, objects, adjustments) — no blind retries.

## Compose prompt

General prompt; a style guard ("keep the supplied background exactly as is — do not move,
remove or restyle existing elements"); one line per object (label, prompt, requested
size); hard rules (all objects fully visible, non-overlapping, away from the edges).
Inputs: background first, then object images in `sortOrder`.

## Master UI

`src/app/(master)/games/[id]/generation-panel.tsx` (client), draft only. Generate button
(`data-testid="generate"`) enabled when background + ≥1 object and state ≠ `running`.
While `running`, `router.refresh()` every 3 s (subscription pattern, no effect+setState).
Run list from `view.generationRuns` (`data-testid="generation-run"`): attempt, status,
duration, failure reason, adjustment. `data-testid="generation-state"` text: `idle`,
`running`, `passed`, `failed`. After a pass the existing Positions canvas shows the dashed
proposals to confirm.

## Eval (`evals/generation/`)

`golden/<case>/{background.png, objects/*.png, case.json}`; `make-golden.ts` (one-off,
Gemini text-to-image: 5 scenes, 10 object cut-outs) — output committed, script kept.
`npm run eval:generation [--backend gemini|paste] [--threshold 0.8]`: per case
`attemptOnce` up to 3 times with accumulated adjustments; prints attempts, final class,
confidences; pass rate; non-zero exit under the threshold. Never in CI.

## Testing

- Unit (ratchet): `prompt`, `diff` (synthetic buffers: single blob, two blobs, speckle,
  edge-touching, merge), `validate` (every class, boundary values, decoy), `boxes`,
  `status` (stale), `paste` placement (no overlap, margin, seeded determinism).
- Integration (Neon test branch): `runGeneration` with paste → `running→passed`,
  `setGeneratedImage` effects; forced-fail backend → three `failed` rows with adjustments,
  stops; concurrent start rejected; stale run treated as failed.
- E2E `e2e/generate.spec.ts` (CI with `GENERATION_MODE=paste`): create game → upload
  background + 2 objects via file inputs → Generate → `passed` → 2 dashed circles → confirm
  → publish. SPEC §8 "upload to published without touching a coordinate value".
- Autonomous-loop evidence (SPEC §8): one real Gemini run's `generation_runs` rows
  recorded in the dev log; not asserted in CI.

## Config

`.env.example`: `GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL`, `GENERATION_MODE`
(`gemini` default; `paste`). `gemini` without `GEMINI_API_KEY` → run fails with
`config: GEMINI_API_KEY not set`. CI `e2e` job sets `GENERATION_MODE=paste`. Deps:
`@google/genai`, `sharp`. `maxDuration = 300` on the master game page segment.

## Known limits

Vercel Hobby's 300 s cap can cut a slow third attempt — surfaced as `failed: stale`, never a
hang. Changing the background after a pass does not reset the generated image (Phase 1
gap, Phase 4). Nano Banana output dims are read, never assumed.
