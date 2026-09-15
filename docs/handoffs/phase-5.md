# Handoff — Phase 5 (UI/UX on shadcn/ui) → next

## Built

- **shadcn/ui foundation** — `src/components/ui/*` (generated), tokens in `globals.css`
  (orange `--primary`, `--success`, radius 0.75rem, dark via `prefers-color-scheme`),
  Geist + Bricolage Grotesque (`font-display`), `cn`, shell (`Header`, `Wordmark`,
  `SubmitButton`), root `not-found`/`error`, `<Toaster>`.
- **Master flow** — `/games` card grid (lazy covers, `LocalTimeRange`); `/games/new` card;
  `/games/[id]` as ordered `StepCard`s (`steps.ts`: `deriveSteps`, `publishBlockers`, pure,
  tested) with a sticky `PublishBar` listing why Publish is disabled; Confirm on the object
  chip in "Confirm positions"; `?ok=` → `SavedToast`.
- **Player flow** — start `Card` (no `image` prop), image-first `PlayScreen` (`PlayerBar`
  with timer + `n / N markers`, rail strip + `Sheet`, sticky trash + Submit, shadcn
  `Dialog` confirm), coarse-pointer hit circles (`useCoarsePointer`), `dotR` 0.008,
  result/finished/leaderboard `Table`, game-scoped `not-found`.
- **Tests** — `e2e/ui.spec.ts` (dialog focus/Esc, phone fit on a `mobile` project, publish
  gate) with `e2e/reseed.ts`; 227 unit; e2e 13 passed / 1 skipped across both projects.

## Contracts exposed

- `redirectBack(gameId, result, saved?: "window" | "position" | "object" | "background")`
  appends `?ok=`; `isSavedWhat` guards it. Codes only in `?error=`, as before.
- `SubmitButton` (`pending || disabled`). `StatusBadge` renders the raw status word, once
  per page (strict e2e `getByText`).
- `ObjectRail({ objects, variant? })` is a client component; `TrashZone` takes `className`;
  `PlayerBar` is a server component with a children slot.
- `listGamesForMaster` rows carry `imageUrl: string | null` (the only `src/lib` change).
- Clerk 7 (Core 3): use `<Show when="signed-in|signed-out">`, not `SignedIn`/`SignedOut`.

## Do not break

- `StartScreen` never gains `image`; canvas geometry untouched; test ids per the plan's
  Global Constraints.
- Never put `items-center` on a `Card`: `CardHeader` has `contain: inline-size` and its
  title collapses to width 0. Centre with `text-center` / `justify-center`.
- `/games` covers are full-size generated PNGs; keep `loading="lazy"` until a thumbnail
  derivative exists.
- `seed` / `test:e2e` delete every `[seed] …` and `[e2e] …` game on `DATABASE_URL`, any
  master.

## Known gaps

- No thumbnail derivative at generation time; the list page is heavy on slow networks.
- e2e runs share the generation daily cap on the dev DB; `generate.spec` fails at `idle`
  once the e2e user is capped — environmental.
- Touch authoring: the handle hit circle can outcompete the centre dot on small radii.
  Shared `pending` briefly disables every Confirm chip. `Sheet` empties during its close
  animation.
- Owner to confirm: `/` header shows "My games" when signed in (the screenshot harness
  lacked Clerk's testing token).
- Carried from Phase 4: master leaderboard, upload cap / EXIF, adjustment contradictions,
  shared dev/prod Neon branch.
