# Handoff — Phase 1 → Phases 2 and 3

## Built

- **Auth**: Clerk via `src/proxy.ts` (public: `/`, `/g/*`, `/sign-in`, `/sign-up`);
  `getCurrentUser()` in `src/lib/auth.ts` lazily mirrors the user into `users`.
- **Authoring core** `src/lib/games/games.ts` — create/update/delete game, add/update/
  confirm/remove object, set window, publish, unpublish, `setGeneratedImage`. Every
  draft-only mutation runs in a transaction with the game row `FOR UPDATE`.
- **Play core** `src/lib/games/play.ts` — start (idempotent), submit (scores, conditional
  UPDATE, markers in-tx), player state, leaderboard. **Reads** `src/lib/games/queries.ts`.
- **Server actions** `src/lib/games/actions.ts` (+ `upload.ts`), master pages under
  `src/app/(master)/games`, storage `src/lib/storage.ts`. 85 unit + 40 integration tests.

## Contracts exposed

- Actions return `ActionResult<T>` = `{ok:true,data} | {ok:false,error,message}`; errors
  are the `ActionError` union in `src/lib/games/result.ts`. Nothing throws for expected
  failures.
- **Phase 3 calls**: `startAttemptAction(publicId)` → `{startedAt}`;
  `submitAttemptAction(publicId, points: {x,y}[])` → `AttemptResult`;
  `getPlayerStateAction(publicId)` → `PlayerAttemptState`; `getLeaderboardAction(publicId)`
  → `LeaderboardEntry[]` or `LEADERBOARD_HIDDEN`; `loadGameForViewer(getDb(), publicId,
  userId, new Date())` → `GameView | null` (`null` ⇒ `notFound()`).
- **Phase 2 calls**: `setGeneratedImage(db, gameId, {key,width,height}, proposals)` — the
  only sanctioned writer of `generated_image_key` and object positions. Keys must be under
  `games/<gameId>/generated/`. `objects.requested_scale` is available as input.
- `requestUploadUrl({gameId, kind, contentType})` presigns a PUT; `isOwnedKey` guards every key write.

## Do not break

- **Image before Start.** `ActiveGameView.image.url` is present for any active game. The
  `/g/[publicId]` page must not send it to the client until `getPlayerStateAction` says
  `in_progress`/`submitted`; render a Start-only tree first. Phase 4 verifies via network tab.
- **Lock discipline.** Never write `objects.x/y/radius/confirmed` or
  `games.generated_image_key` directly — use `setGeneratedImage` / `updateObject`, which
  lock the game row. Direct writes reopen the invariant-4 race.
- **Server time only.** Actions pass `new Date()`; `elapsed_ms` is DB-generated. Never
  accept a timestamp from the client.
- **Validate at the boundary.** The `Normalized` brand does not survive JSON; use
  `isNormalized`, `isUuid`, `isAssetKind`, `isOwnedKey` before touching the DB.
- `/api/generate/*` is **not** public. Any route handler there resolves the user or
  verifies a secret.

## Known gaps

- `setGeneratedImage` does not `isUuid`-check `proposals[].objectId` (Phase 2: add before
  wiring). One test still uses a placeholder key that passes only by check ordering.
- Add-object form has no pending-disable → double-click adds twice (seen in walkthrough).
- `changing backgroundKey` does not reset the generated image/confirmations — Phase 4
  with imagegen.
- Playwright skeleton, `test:e2e`, seed, paste fallback: still owed from Phase 0.
- `deleteGameAction` has no UI. CI `update-baseline` stalls on `main` until the
  `TEST_DATABASE_URL*` secrets exist.
