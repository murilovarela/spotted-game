# Handoff — Phase 0 → Phase 1

## Built

- `src/db/schema.ts` — six tables per SPEC §5.2, CHECKs for every invariant the DB can
  hold. Migrations `0000`, `0001` applied to the Neon dev branch.
- `src/lib/types.ts` — `Normalized` brand, status enums, every client-facing shape:
  game views, `AttemptResult`, `PlayerAttemptState`, `LeaderboardEntry`, `GenerationRunView`.
- `src/lib/scoring.ts`, `src/lib/status.ts`, `src/lib/visibility.ts` — pure, 51 tests.
  CI ratchet on `main` (SYSTEM.md §5.4), fails closed on tool crashes.

## Contracts exposed

- **`projectGame({ game, objects, generationRuns?, userId, now, resolveUrl })`** →
  `GameView | null` (`null` = 404). Derives status and master-vs-player itself; callers
  pass facts. `resolveUrl` signs a storage key — image columns hold **keys**, not URLs.
- **`deriveStatus(game, now)`** — sole definition of the four states; both boundaries inclusive.
- **`scoreAttempt({ markers, objects, image })`** → `{ foundCount, assignments[] }`.
  `assignments` is server-only; persist to `markers.matched_object_id`, return
  `AttemptResult` to the client.
- **Tables**: `users` (id = Clerk id), `games`, `objects`, `attempts`, `markers`,
  `generation_runs`. Row types `Game`, `NewGame`, etc. Env: `.env.example`.

## Do not break

- Game data leaves the server only through `projectGame`; an attempt only as
  `AttemptResult` / `PlayerAttemptState`; a leaderboard row only as `LeaderboardEntry`,
  and only after the viewer has submitted.
- **Submit** is `UPDATE attempts SET submitted_at, found_count WHERE id = $1 AND
  submitted_at IS NULL`; row count 0 → reject. Markers insert in the same transaction.
  Never write `elapsed_ms`; the DB computes it.
- **Any write to `objects.x/y/radius` or `games.generated_image_key` resets
  `objects.confirmed = false`.** Publish re-checks all confirmed in its transaction.
- Radius is a fraction of image **width**; scoring scales dy by height/width; canvas
  must draw the same way. Enforce N markers at the action boundary; scoring assumes it.
- `db:migrate`, never `db:push`. Migrations are generated, never edited.
- `schema.ts`, `types.ts`, `visibility.ts` are frozen. Changing them stops all streams.
- Coverage ratchet covers `src/lib/**` minus `games/**`, `generation/**`. Opt pure modules
  in via `vitest.config.ts`; lower a bar only by editing `quality-baseline.json` in the PR.

## Known gaps

- **No DB client.** `neon-http` can't run the publish transaction; expect
  `drizzle-orm/neon-serverless` + `Pool`. **No `resolveUrl` impl** (S3 presign). Phase 1.
- **No Playwright skeleton, `test:e2e`, or E2E CI job.** SPEC §8 requires them.
- **No seed, no paste fallback.** Listed under Phase 0 in SPEC §7; still owed.
- Hook gap: `Edit|Write` hooks don't see shell writes. Open in the corrections table.
