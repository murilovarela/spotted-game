# Handoff — Phase 2 → Phase 4 (integration, deploy)

## Built

- **Pipeline** `src/lib/generation/` (SPEC §5.3): pure `prompt`, `diff`, `validate`
  (+ `background_altered`), `boxes`, `status`, `labels`, `placement`; sharp-only
  `images.ts`; `GenerationBackend` with `gemini` (`gemini-3.1-flash-image` + vision
  `gemini-3.6-flash`, JSON labels over candidate crops only) and `paste` (deterministic,
  same diff → validate path).
- **Loop** `run.ts`: a `generation_runs` row before every backend call, finalized on every
  path (`vision_response` = image key, dims, candidates, labels, raw). Cap 3; stops when an
  attempt adds no new adjustment. `startGenerationAction` guards under the game lock and
  runs the loop in Next `after()`; page `maxDuration = 300`.
- **Master UI** `generation-panel.tsx`: Generate, polling, run list with reason and
  adjustment, next-step copy per class. Proposals land on the Phase 3 canvas unconfirmed.
- **Harness**: `e2e/generate.spec.ts` (upload → generate → confirm → publish; CI in
  `GENERATION_MODE=paste`); `evals/generation` golden set (5 scenes, 10 objects) +
  `npm run eval:generation` — Gemini 5/5, paste 5/5. 183 unit, 7 integration tests.

## Contracts exposed

- `GENERATION_MODE=gemini|paste`, `GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL`,
  `GEMINI_API_KEY`. Missing key in gemini mode → run row `config: …`, never a throw.
- `deriveGenerationState(runs, now)` → `idle | running | passed | failed{reason, attempts}`;
  `running` > 10 min ⇒ `failed: stale…`.
- `attemptOnce(backend, GameInput, adjustments)` is the eval's and the loop's shared step.
- `storage.getObject(key)`; inputs to the model are bounded (background ≤ 1536 px, objects
  ≤ 512 px long side) before leaving the server.
- Failure classes: `absent | low_confidence | overlap | out_of_bounds | scale |
  background_altered | config | error | stale` — reasons are `class: Label — detail` lines.

## Do not break

- Only `setGeneratedImage` writes `generated_image_key` and object positions; the loop
  calls it with proposals normalized against the generated image's *actual* dims.
- A row must exist before any paid call and must be finalized in every path — the
  `queued`-only claim in `runGeneration` is what stops a late `after()` from running twice.
- Vision labels crops; it never searches the frame. Do not pass the whole scene as the
  thing to search.
- SPEC thresholds (0.6 / 3 % / 20 % / 10× / 3 attempts) live in `types.ts`; tune only
  `DIFF_DEFAULTS` and prompts, and re-run the eval when you do.
- CI never calls Gemini; the `e2e` job runs after `integration` truncates the test branch.

## Known gaps

- Vercel's 300 s cap cuts a slow third attempt; it surfaces as `stale` (derived, the row
  is never finalized in the DB). No test drives three attempts with changing adjustments.
- Millisecond window between finalizing attempt N and inserting N+1 where a second
  `startGeneration` could be admitted.
- Failed-attempt PNGs stay in the bucket; no upload size cap on the presigned PUT.
- `DIFF_DEFAULTS` (60/1) calibrated on ten frames from one model; no per-user quota.
- Evidence run (game `31defdcf…`): per-object adjustments accumulate and can contradict
  (`absent` "larger" + `scale` "3 %"); a merged diff region reads as `absent` when the object
  touches a neighbour. A `scale` adjustment should replace an earlier `absent` one, and
  vision could be allowed to name more than one object per crop.
- **Phase 4 prerequisites before a public deploy with a live key** (integration review):
  stable presigned URLs — the panel's 3 s `router.refresh()` re-signs every image URL and
  reloads them each poll; and a per-user generation cap (owner-only today, unlimited).
- Stale rows are derived, never finalized (`running` row stays under a `failed` header;
  lockout up to ~15 min); EXIF orientation is not applied (`sharp().rotate()`); local E2E
  against an already-running `gemini` dev server spends real quota.
- Phase 4 owes: master-side leaderboard, deploy verification.
