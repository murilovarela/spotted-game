# Phase 3 — Canvas, play surface, E2E harness: design

Approved in chat 2026-09-13. Argues from `docs/SPEC.md` §3.3, §3.4, §6.3, §8, §11 and
`docs/handoffs/phase-1.md`. Phase 2 (imagegen) runs separately; the deterministic paste
fallback moves there as its first task.

## Scope

- `MarkerCanvas` with three modes (`play`, `author`, `reveal`) — SPEC §6.3 "one canvas".
- `/g/[publicId]`: start → play → result; finished reveal; master redirect.
- Authoring integration on `/games/[id]`: drag-to-position, confirm.
- Owed from Phase 0: `npm run seed`, Playwright skeleton, `test:e2e`, CI `e2e` job.
- Not in scope: generation, paste fallback, polling/live leaderboard, mobile gestures
  beyond pointer events, accessibility beyond keyboard-reachable controls (SPEC §10).

## Rendering

`<div class="relative"><img src width height/><svg viewBox="0 0 W H"
preserveAspectRatio="none" class="absolute inset-0"/></div>`. Markers and radius circles
are SVG elements in image-pixel space; the browser scales them with the image. Radius is a
fraction of image *width* (Phase 0 decision); in pixel space it is a plain circle of
`radius * width`, so what the master sees is exactly the scoring geometry.

Pointer → normalized: `(clientX − rect.left) / rect.width`, `(clientY − rect.top) /
rect.height`, clamped to `[0,1]` while dragging, rejected (no add) when the pointer-down
is outside the image. Coordinates leave the component only as `NormalizedPoint` /
`NormalizedCircle` built with `normalized()`.

## Components (`src/components/canvas/`)

| File | Responsibility |
| --- | --- |
| `geometry.ts` | Pure: `toNormalized`, `toPixel`, `radiusPx`, `nudge`, `clampPoint`. |
| `marker-state.ts` | Pure reducer for play mode: `add` (cap `max`), `move`, `remove`, `select`; state `{ markers: PlayMarker[]; selected: string \| null }`. |
| `format.ts` | Pure: `formatElapsed(ms)` → `m:ss.t`. |
| `marker-canvas.tsx` | Client. Controlled. Props: `image: GameImage`, `mode`, `markers: CanvasMarker[]`, `selectedId`, `max`, `onChange?`, `onSelect?`, `onPlace?(point)`. |
| `trash-zone.tsx` | Drop target; a marker released over it is removed (play mode). |
| `timer.tsx` | Client. Props `startedAt`, `serverNow`. Ticks locally using `serverNow − Date.now()` offset. Display only. |
| `object-rail.tsx` | Thumbnails of all N objects, always visible during play and authoring. |

`CanvasMarker = { id: string; x: Normalized; y: Normalized; radius?: Normalized;
label?: string; confirmed?: boolean }`.

Interaction:
- **play**: pointer-down on empty space adds a marker (until `max`); pointer-drag moves;
  release over `TrashZone` removes; focused marker: arrow keys nudge (1/200 of the
  frame), `Delete`/`Backspace` removes. No radius drawn. Markers unlabelled (§11).
- **author**: every object is a marker with a radius circle and one resize handle on the
  circle's right edge. Drag centre moves, drag handle resizes (min radius 0.01). `onChange`
  fires on pointer-up only (one server write per gesture). Pointer-down on empty space
  with an *unplaced* selected object calls `onPlace(point)`; the parent adds it at
  radius `0.05`.
- **reveal**: read-only circles with labels.
- Every marker is `<g tabindex="0" data-testid="marker" data-marker-id>`; the canvas root
  is `data-testid="marker-canvas"`.

## Play surface (`src/app/g/[publicId]/`)

`page.tsx` is a server component, `dynamic = "force-dynamic"`. It calls
`loadGameForViewer(getDb(), publicId, user?.id ?? null, new Date())`; `null` → `notFound()`.

| View | Render |
| --- | --- |
| `MasterGameView` | `redirect("/games/" + view.id)` — masters never play (§11). |
| `FinishedGameView` | `MarkerCanvas mode="reveal"` with object circles + `Leaderboard` (always visible once finished). |
| `ActiveGameView` | Branch on `getPlayerState` (server side). `UNAUTHENTICATED` is treated as `not_started`. |

Active branches:
- `not_started` → `StartScreen` (server). Receives **only** `{ publicId, title, objects }`
  — `image` is never passed into this tree, so the HTML payload contains no generated
  URL. Shows thumbnails, the abandonment warning (§3.3, verbatim intent: timer runs from
  Start, does not pause, unsubmitted attempts never reach the leaderboard), and a Start
  button. Signed in: server action → `startAttemptAction` → `revalidatePath`. Signed out:
  link to `/sign-in?redirect_url=/g/<publicId>`.
- `in_progress` → `PlayScreen` (client): `MarkerCanvas mode="play"`, `ObjectRail`,
  `Timer`, `TrashZone`, count `k / N`, Submit disabled until `k === N`. Submit opens a
  confirm dialog stating one submission per game; confirm → `submitAttemptAction(publicId,
  markers)`; on `ok` or on `ALREADY_SUBMITTED`/`NOT_ACTIVE` → `router.refresh()`; other
  errors shown inline.
- `submitted` → `ResultScreen`: `found / N`, `formatElapsed`, the image with **no**
  markers (§3.3.7), `Leaderboard` from `getLeaderboardAction`.

`Leaderboard` renders rank, name, found, time; highlights `isViewer`. No polling.

## Authoring integration (`src/app/(master)/games/[id]/`)

When `view.image` is non-null, `AuthorCanvas` (client) renders above the object list with
`MarkerCanvas mode={editable ? "author" : "reveal"}`. Object rows gain a select state
(highlighted circle). Pointer-up after a move/resize → `updateObjectAction(gameId, id,
{ x, y, radius })` (already resets `confirmed`) → `router.refresh()`. Unplaced object:
select row → click canvas → same action at radius `0.05`. Row Confirm/Remove stay as
server-action forms. Numeric readout stays as a caption.

## Seed (`src/db/seed/`)

`npm run seed` (tsx). Uses `DATABASE_URL` and storage credentials. Idempotent: deletes
games titled `[seed] …` first. Creates, owned by `SEED_MASTER_ID ?? "seed-master"`
(users row inserted if missing): draft (image + 3 objects, one unconfirmed, window set,
unpublished), scheduled (+1d), active (−1h → +1d), finished (−2d → −1h, three attempts by
`seed-player-{1,2,3}`); plus scheduled/active/finished games owned by `seed-opponent` so
the master account can be a player (404 check, play, reveal). `--json` prints the ids.
Fixtures in `src/db/seed/fixtures/`: `background.png` (1024×768), `object-{1,2,3}.png`,
`generated.png` (background with the three objects pasted; committed, made once).
Uploads via the S3 client to `games/<id>/{background,object,generated}/…`; positions go
through `setGeneratedImage` + `confirmObject` so lock discipline holds.

## E2E (`e2e/`, `playwright.config.ts`)

- Auth via **Clerk sign-in tokens** (ticket strategy): works with a Google-only sign-in
  configuration and needs no dashboard changes. `global-setup.ts`: (1) resolve the test
  user — `E2E_CLERK_USER_ID` if set, else find-or-create `e2e@spotted.test` via
  `clerkClient.users`; (2) run the seed with `SEED_MASTER_ID=<id>`; (3) `clerkSetup()` +
  `setupClerkTestingToken`, then `clerk.signIn({ page, emailAddress })` from
  `@clerk/testing/playwright` — it mints a sign-in token via the Backend API and signs in
  with the ticket strategy — and save `storageState`.
- `webServer`: `npm run build && npm run start` (CI) / reuse dev server locally.
- Specs: `play.spec.ts` (start → markers add/drag/trash → submit gated → confirm → result
  → leaderboard; **network assertion**: no response before Start contains `generated/`;
  submit response contains no `x`/`y`), `lifecycle.spec.ts` (scheduled → 404; finished →
  reveal + leaderboard), `author.spec.ts` (drag → unconfirmed → Publish blocked → confirm
  → Publish → scheduled).
- CI job `e2e`: `needs: integration`, concurrency group `integration-neon`,
  `DATABASE_URL=${{ secrets.TEST_DATABASE_URL }}`, skips with `outputs.status=skipped`
  when any required secret is absent; uploads the Playwright report on failure.
  `update-baseline` requires `e2e` to be `pass`.
- No dashboard precondition. Secrets: `TEST_DATABASE_URL`, `AWS_*`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (dev instance); optional
  `E2E_CLERK_USER_ID`.

## Testing

Unit (in ratchet): `geometry`, `marker-state`, `format`. Coverage config excludes
`src/components/**` and `src/app/**` (UI is verified by E2E). Existing invariant test
suite unchanged. E2E as above.

## Invariants touched

1. Image-before-Start: enforced by prop shape (`StartScreen` cannot receive `image`) and
   asserted by E2E network check.
2. No coordinates on the wire: play mode sends `NormalizedPoint[]` up only; result and
   leaderboard views carry none (Phase 1 projection); E2E asserts the submit response.
3. Server time: `Timer` is display-only; `startedAt` comes from the action result.
