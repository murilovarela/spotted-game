# Handoff — Phase 4 (deploy) → UI phase

## Built

- **Production** at `https://spotted.murilovarela.dev` (Vercel via `npx vercel --prod`;
  Clerk dev instance; the *development* Neon branch as database, for now). Runbook:
  `docs/DEPLOY.md`.
- **Stable image URLs** — `presignGet(key, now)` in `src/lib/storage.ts` signs with an
  hour-bucketed `signingDate` and a 2 h expiry, so polling re-renders reuse the same URL.
- **One loop per master, bounded** — `startGeneration` locks the `users` row, finalizes
  stale runs (`STALE_AFTER_MS`, `STALE_REASON`), rejects a live run on any of the master's
  games, and enforces `GENERATION_DAILY_CAP` (default 20 attempt rows per rolling 24 h).
- **Remote Playwright** — `PLAYWRIGHT_BASE_URL` runs `e2e/` against a deployment (7/7 on
  production; `generate.spec` skips). README rewritten for the product.

## Contracts exposed

- `presignGet(key, now = new Date())`, `urlResolverFor(keys)` — never `keys.map(presignGet)`.
- `startGeneration(db, user, gameId, now, { dailyCap })` errors: "already running on this
  game", "already running on another of your games", "Daily generation limit reached (N
  attempts per 24 h)". `dailyCapFromEnv(env)` in `run.ts`.
- Env: `GENERATION_DAILY_CAP`, `PLAYWRIGHT_BASE_URL`; `NEXT_PUBLIC_APP_URL` is gone.
- `engines.node: "22.x"` pins the Vercel build (the project defaulted to Node 24).

## Do not break

- Lock order is `users(u)` → `games(g)`; nothing may take `games` then `users`.
- `page.tsx` for the master game keeps `maxDuration = 300` (needs Fluid Compute on
  Hobby); `STALE_AFTER_MS` (10 min) must stay ≥ that.
- Bucket CORS is already `*`; do not add an origin env var back.
- `npm run seed` / `npm run test:e2e` mutate whatever `DATABASE_URL` points at — today
  that is production. Reseed as the owner after any e2e run (DEPLOY.md §5).

## Known gaps

- Production shares the dev Neon branch; move it before inviting real players.
- Owner-owed on production: `SEED_MASTER_ID=<clerk id> npm run seed`, one second-account
  play, one real Gemini generation (first `sharp` run on Vercel).
- Daily cap is checked once per click; a loop can overshoot by two rows.
- Dead window: a loop killed at 300 s reads as live until 600 s, blocking all the
  master's games; a stale row elsewhere is only finalized when *that* game starts.
- Carried from Phase 3: no master leaderboard, no upload size cap / EXIF strip,
  adjustment contradictions accumulate, author-cache expiry on concurrent writers, dialog
  focus trap, one-line `INVALID_INPUT` copy, window form's offset-less date parse untested.
- UI/UX is unstyled — next phase (shadcn/ui), restyling chrome around the SVG canvas, not
  the overlay geometry.
