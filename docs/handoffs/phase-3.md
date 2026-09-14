# Handoff — Phase 3 → Phase 2 (imagegen) and Phase 4 (integration)

## Built

- **One canvas, three modes** — `src/components/canvas/marker-canvas.tsx` (`play`/`author`/
  `reveal`): SVG overlay in image-pixel space; pure maths in `geometry.ts`, reducer in
  `marker-state.ts`. Plus `Timer` (display-only), `ObjectRail`, `Leaderboard`, `TrashZone`.
- **Play surface** `src/app/g/[publicId]/` — Start (no image in the tree) → play → result;
  finished reveal; masters redirected to `/games/<id>`; `?error=` carries codes only.
- **Authoring** — `src/app/(master)/games/[id]/author-canvas.tsx`: drag centre/handle, click
  to place, one `updateObjectAction` per gesture, optimistic cache for successive gestures.
- **Harness** — `npm run seed` (7 games, committed fixtures, drives the Phase 1 core with
  a shifted `now`); Playwright (`e2e/`, Clerk sign-in token, seed in global setup, 7 specs
  incl. wire-level image-before-Start and no-coordinates checks); CI `e2e` job gated into
  `update-baseline`. 111 unit tests, coverage 97.47.

## Contracts exposed

- `CanvasMarker = { id, x, y, radius?, label?, confirmed? }`; `MarkerCanvas` props
  `image, mode, markers, selectedId, canAdd, onAdd/onMove/onResize/onRemove/onSelect,
  trashRef`; one callback per completed gesture, values already `Normalized`.
- DOM test ids are a contract with `e2e/*.spec.ts` (`marker-canvas[data-mode]`, `marker`,
  `radius-handle`, `trash-zone`, `submit`, `confirm-submit-yes`, `result`, …).
- Seed: `npm run seed -- --json` → `{ masterId, mine{draft,scheduled,active,finished},
  theirs{scheduled,active,finished} }`, titles `[seed] …`, `SEED_MASTER_ID` env.
- E2E env: `TEST_DATABASE_URL(_UNPOOLED)`, `AWS_*`, both Clerk keys; optional
  `E2E_CLERK_USER_ID` (dedicated test user; global setup may set its primary email).
- `putObject(key, contentType, body)` in `src/lib/storage.ts` — Phase 2 uploads the
  generated image with it, then calls `setGeneratedImage`.

## Do not break

- `StartScreen` must never gain an `image` prop; `page.tsx` builds `common` without it.
  `e2e/play.spec.ts` fails if `/generated/` appears on the wire before Start.
- Every position write stays behind `updateObjectAction` (resets `confirmed`); the author
  cache reconciles by exact equality, so the action must persist exactly what it receives.
- `Timer` takes numbers only; never pass a client time to an action.
- Redirects carry `ActionError` codes, not messages; add copy in `error-copy.ts`.
- CI: `integration` truncates the test branch, then `e2e` seeds (`needs`). Keep that order.

## Known gaps

- Master edit page shows no leaderboard for published games (`getLeaderboard` already
  allows it) — Phase 4.
- Presigned URLs change every render (preview reloads on each save); a bucketed
  `signingDate` would stabilise them — Phase 4.
- Author cache entry never expires if a *concurrent* writer (Phase 2's `setGeneratedImage`,
  another tab) changes the row between save and response — clear on `ok` or key by
  `image.url` when Phase 2 lands.
- Master-page copy collapses every `INVALID_INPUT` into one line; split codes if needed.
- `e2e` shares the `integration-neon` concurrency group; overlapping PR runs may cancel
  one `e2e` (reads as ❌). Give it its own group if that shows up.
- No E2E for a failing save's snap-back; confirm dialog has no focus trap (SPEC §10).
- Authoring E2E starts from a seeded generated image; upload → generate → publish
  end-to-end waits on Phase 2's paste fallback.
