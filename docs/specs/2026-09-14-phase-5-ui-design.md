# Phase 5 — UI/UX on shadcn/ui: design

Approved in chat 2026-09-14 (sections 1–5). Argues from `docs/SPEC.md` §8 (player
experience), §6 (master flow) and the "UI/UX is unstyled" gap in `docs/handoffs/phase-4.md`.
Owner's verdict on the current UI: "looks terrible and the ux is terrible too."

## Scope

In: shadcn/ui foundation on Tailwind v4; every page restyled; the three flows redesigned
(master edit page as a status-driven, ordered set of steps with an explained publish
gate; image-first, phone-first play page; landing and games list). Playful, game-like
look. Phone-first for players, desktop-first (phone-usable) for masters.

Out: dark-mode toggle (system preference only, as today), i18n, motion beyond shadcn
defaults, master-side leaderboard, upload size cap / EXIF, any change to server actions,
schema, scoring, visibility, generation, storage, or the SVG overlay geometry.

## 1. Foundation

- `npx shadcn@latest init` (Tailwind v4 mode): `components.json`, CSS variables in
  `src/app/globals.css`, `src/components/ui/*`, `src/lib/utils.ts` exporting `cn`
  (`clsx` + `tailwind-merge`). Base colour neutral, radius `0.75rem`. Accent
  `--primary` warm orange; `--success` and `--destructive` defined. Dark values under
  `@media (prefers-color-scheme: dark)` — no class toggle.
- Fonts: Geist (body, via `next/font/google` as today) + one display face for headings
  and the timer (`--font-display`), also via `next/font/google`. Tabular numerals on the
  timer.
- Icons: `lucide-react`.
- Installed components: `button input label textarea card badge alert dialog sheet table
  separator progress skeleton tooltip sonner`. `src/components/ui/*` is generated code:
  theme edits only, never hand-edited logic; app components wrap them.
- App shell: `src/components/shell/header.tsx` (wordmark, "My games", Clerk
  `UserButton`) used by `(master)/layout.tsx` and the landing; player pages render a
  minimal wordmark-only header, hidden on the play screen.
- Untouched: `src/components/canvas/marker-canvas.tsx` SVG overlay and its maths
  (`geometry.ts`, `marker-state.ts`, `format.ts`). The one permitted change there is the
  hit-area size of the invisible pointer targets on coarse pointers (§3).

## 2. Master flow

### `/games`
Title + primary "New game" `Button`. `Card` grid: title, cover thumbnail (generated image
if present, else a neutral placeholder), lifecycle `Badge` (draft / scheduled / active /
finished via `deriveStatus`), window shown in the browser's local time (client component
`LocalTime`, ISO string in, UTC on the server — invariant 6). Empty state `Card` with the
same CTA. `loading.tsx` with `Skeleton` cards.

### `/games/new`
One `Card` form: title, description. Create `Button` with `useFormStatus` pending state.
Inline `Alert` from `?error=` via the existing `error-copy.ts`.

### `/games/[id]`
Sticky page header: title, lifecycle `Badge`, public link (copy button) when published.
Steps as `Card`s in working order, each with a step number and a done/todo indicator
derived server-side from the row (`src/app/(master)/games/[id]/steps.ts`, pure):

1. **Background** — upload zone styling around the existing file input (drag-over
   state), preview, "Replace".
2. **Objects** — rows: thumbnail, name, description, `confirmed` Badge, remove; inline
   add form; `n / 5` counter; add disabled at 5.
3. **Generate** — `generation-panel` restyled: primary "Generate" `Button`; attempts as
   a timeline (status icon, duration, failure reasons); adjustments in a collapsible;
   disabled reason as text (no background / no objects / running elsewhere / daily cap).
4. **Confirm positions** — `author-canvas` chrome: object chips as toggle `Badge`
   buttons (`aria-pressed` kept), `TrashZone` as a dashed drop target; canvas untouched.
5. **Window** — `window-fields` with `Label` + `Input type=datetime-local` + helper
   text (local time; stored UTC); Save with pending state; success toast.
6. **Publish** — sticky footer bar: lifecycle `Badge`, the single primary action
   (Publish / Unpublish), and the blockers list from `publishBlockers(game)` (pure;
   same checks the publish transaction makes: unconfirmed objects, no generated image,
   no window). Disabled state explains itself; invariant 4 still enforced only in the
   transaction.

Draft-only steps render read-only with a "locked after publish" `Badge` once published,
matching the server's draft-only rules. Errors keep the `?error=` code protocol;
`INVALID_INPUT` copy split per field where the action already distinguishes them.
`Sonner` toasts for successful window/position saves.

## 3. Player flow (`/g/[publicId]`)

- **Start**: centred `Card` — title, description, object count, "ends in" from server
  `now`, primary "Start" `Button` or "Sign in to start" link. `StartScreen` keeps its
  prop shape: no `image` prop, ever (`e2e/play.spec.ts` wire check).
- **Play**, image-first:
  - Top bar (sticky, compact): wordmark, `Timer` (display font, tabular), `marker-count`
    as `n / N` Badge.
  - Canvas fills the viewport width; capped to viewport height on desktop; edge-to-edge
    on phone. Sized box stays (reflow guard for e2e `settled()`).
  - Object rail: horizontal thumbnail strip under the canvas on phone, side column on
    `lg+`; tapping a chip opens a `Sheet` with the larger reference image and
    description. `data-testid="object-rail"` kept.
  - Bottom bar: `TrashZone` + fixed primary "Submit (n)" `Button`.
  - Confirm: shadcn `Dialog` (focus trap, Esc). Ids `confirm-submit`,
    `confirm-submit-yes` kept.
  - Coarse pointers: `@media (pointer: coarse)` enlarges only the invisible hit circles
    of markers and handles in `marker-canvas.tsx`; positions and radii unchanged.
- **Result**: score hero (found / total, elapsed), per-object hit/miss list, reveal
  canvas (`mode="reveal"`), `Leaderboard` as `Table` with own row highlighted, "Play
  another" → `/`.
- **Finished** (window over): reveal canvas + leaderboard, no score hero.
- `not-found.tsx` under `g/[publicId]`: "This game isn't open" + link home (draft,
  scheduled, unknown — same `notFound()` calls).

## 4. Landing, auth, global

- `/`: hero (wordmark, one-line pitch, "Sign in to make a game" / "My games"), "How it
  works" three steps (upload → generate → share), one sample frame built from committed
  seed fixtures — never the owner's photos.
- Auth: Clerk `<SignIn/>`/`<SignUp/>` centred in the shell; `appearance.variables`
  (`colorPrimary`, `borderRadius`, `fontFamily`) mapped to the theme tokens.
- Root `not-found.tsx`, root `error.tsx` (client; message + retry), `loading.tsx` for
  `/games` and `/games/[id]`.

## 5. Testing and delivery

- Unit: `publishBlockers`, `steps` (done/todo derivation), `LocalTime` formatting;
  coverage ratchet holds.
- E2E: existing suite passes unchanged. Test ids preserved: `marker-canvas`
  (`data-mode`), `marker`, `radius-handle`, `object-rail`, `object-chip`, `timer`,
  `trash-zone`, `submit`, `marker-count`, `confirm-submit`, `confirm-submit-yes`,
  `result`, `leaderboard`, `generate`, `generation-state`, `generation-run`; roles
  `button` (Start, Publish, Confirm, Save window, Create, Add object), `link` ("Sign in
  to start"), `alert`, `dialog`. New: confirm dialog traps focus and closes on Esc; play page at
  390×844 has no horizontal scroll and Submit is visible without scrolling; publish
  blockers are listed while Publish is disabled and disappear once confirmed.
- Visual: `qa-playwright` screenshots (phone + desktop) of start/play/result and the
  edit page in the review package; not a CI gate.
- Branch `phase-5/ui`; task order foundation → master → player → landing/global → e2e;
  whole-branch review + integration reviewer; Git-integration deploy on merge.
