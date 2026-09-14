# Phase 4 — Integration, review pass, deploy: design

Approved in chat 2026-09-14. Argues from `docs/SPEC.md` §7 (Phase 4), §9 (definition of
done) and the known-gap lists in `docs/handoffs/phase-2.md` / `phase-3.md`.

## Scope

In: the two deploy prerequisites (stable presigned URLs, per-user generation cap) plus
stale-row finalization; Vercel deploy driven by CLI with the Clerk **dev** instance;
remote-capable Playwright run as deploy verification; `README.md`; `SYSTEM.md` accuracy
(§4.3/§4.4); review pass (invariants, security, integration reviewer); phase handoff.
Out (deferred to the handoff): master-side leaderboard, upload size cap / EXIF rotation,
pipeline adjustment contradictions, author-cache concurrent-writer expiry, dialog focus
trap, finer `INVALID_INPUT` copy, e2e concurrency group.

## Code

- `src/lib/storage.ts` `presignGet`: `getSignedUrl(…, { expiresIn: 7200, signingDate:
  hourBucket(now) })` where `hourBucket` floors to the hour (pure, exported for tests).
  Same key + same hour ⇒ identical URL; a URL minted at :59 stays valid ≥ 61 min.
  `presignPut` unchanged. Effect: the master panel's polling no longer reloads images.
- `src/lib/generation/run.ts` `startGeneration` (inside the existing game-lock tx):
  1. if the derived state of this game is `stale`, finalize that row: `status failed`,
     `failureReason = STALE_REASON`, `finishedAt = now`, `durationMs`; then continue;
  2. reject `INVALID_INPUT "A generation is already running on another of your games"`
     when any `generation_runs` row for a game with this `master_id` is `running|queued`
     and not stale;
  3. reject `INVALID_INPUT "Daily generation limit reached (N attempts per 24 h)"` when
     the master's attempts started in the last 24 h ≥ `GENERATION_DAILY_CAP` (env,
     default 20, parsed once in `actions.ts` and passed as an option).
  Integration tests for all three.
- `playwright.config.ts`: `PLAYWRIGHT_BASE_URL` — when set, `use.baseURL` is that URL and
  `webServer` is omitted; `generate.spec.ts` skips when remote (the live server runs
  Gemini). Global setup unchanged (seeds `DATABASE_URL`, signs in with the Clerk dev
  instance — the same instance the deployment uses).
- `vercel` devDependency; no `vercel.json`.

## Deploy procedure (`docs/DEPLOY.md`)

1. Env vars (Vercel dashboard, Production): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
   (Neon **main** branch), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`,
   `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`,
   `GEMINI_VISION_MODEL`, `GENERATION_MODE=gemini`, `GENERATION_DAILY_CAP=20`,
   `NEXT_PUBLIC_APP_URL=https://<project>.vercel.app`.
2. Bucket CORS: add the Vercel origin to `assets`' AllowedOrigins (Neon dashboard).
3. `npx vercel --prod` (agent) → URL.
4. Migrate + seed against production, run by the owner (agents never hold `.env*`):
   `DATABASE_URL_UNPOOLED=<unpooled> npm run db:migrate` and
   `DATABASE_URL=<pooled> SEED_MASTER_ID=<clerk id> npm run seed`.
5. Verify: `PLAYWRIGHT_BASE_URL=<url> DATABASE_URL=<pooled> npm run test:e2e` (play,
   lifecycle, author specs against the live app with the Clerk test user), plus one manual
   play from a second Google account (§9.1).

## Docs

- `README.md`: what it is, stack, local setup (Neon, Clerk, storage, migrate, seed, dev),
  commands, tests + CI ratchet, deploy pointer, docs map, invariants pointer.
- `docs/SYSTEM.md` §4.3/§4.4: replace the non-existent parallel-timeline/worktree evidence
  with what happened — streams A (Phase 1), C (Phase 3), B (Phase 2) ran sequentially, one
  session each, each through the same brief → implement → review → fix loop, merged in
  that order with an integration-reviewer gate; `docs/evidence/timeline.md` generated from
  `git log` (branch, first/last commit, merge). §7 corrections gets the row.
- `docs/handoffs/phase-4.md`, dev-log Phase 4 entry.

## Review pass

`/check-invariants`, `/security-review` on the branch; `integration-reviewer` after deploy
with the live URL; CRITICAL/HIGH fixed before merge.
