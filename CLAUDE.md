# Spotted

A hidden-object game platform. A game master composes a puzzle from a background image and
up to five object images; players find them against the clock.

Full specification: `docs/SPEC.md`. Engineering system: `docs/SYSTEM.md`.
Read the spec before implementing anything; do not re-derive requirements from code.

## Invariants

These are correctness-critical. Violating one is a bug even if tests pass.

1. **Coordinates never reach the client while a game is `active`.** Scoring happens
   server-side and responses carry hit/miss only. Covered by `src/lib/__tests__/invariants.test.ts`.
2. **All coordinates are normalized `[0,1]` against the generated image**, never the
   uploaded background, never pixels. Use the `NormalizedPoint` type; do not use bare numbers.
3. **Game status is derived on read** from `starts_at` / `ends_at` / `published_at`.
   There is no status column and no scheduler.
4. **A game cannot be published with an unconfirmed object.** Enforced in the publish
   transaction, not in the UI.
5. **Elapsed time is server-anchored.** `started_at` is written server-side; the client's
   clock is never trusted.
6. **All timestamps are UTC.** Convert at the display boundary only.

## Conventions

- TypeScript strict. No `any`; use `unknown` and narrow.
- Server actions over route handlers, except where a webhook or polling endpoint needs a URL.
- Drizzle for all database access. No raw SQL outside migrations.
- Pure functions for scoring, validation, and coordinate maths — data in, data out, no I/O.
  These carry the correctness load and must be unit-testable without fixtures.
- Colocate tests as `__tests__/*.test.ts` next to the code they cover.
- At the end of each session, add an entry to `docs/AI-DEV-LOG.md` following its
  "How to write an entry" section. It is narration source: plain language, failures included.

## Commands

| | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run verify` | Typecheck + lint + unit. What the Stop hook runs. |
| `npm run test:e2e` | Playwright |
| `npm run eval:generation` | Generation quality against the golden set |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:push` | Apply schema to the database |
| `npm run seed` | Demo games in all four lifecycle states |

## Protected paths

Enforced by `.claude/hooks/guard-paths.mjs`, not by convention:

- `.env*` (except `.env.example`) — never written by an agent
- `db/migrations/**` — generated, never hand-edited. Change `src/db/schema.ts` and run
  `npm run db:generate`.

## Subagents

- `scout` — investigate the codebase, get findings back instead of file contents
- `image-pipeline` — all generation work; owns `src/lib/generation/**`
- `qa-playwright` — browser verification against SPEC §8
- `integration-reviewer` — fresh-context review at phase boundaries

## Workstream ownership

When working in a worktree, stay inside your stream's directories. The shared contract is
`src/db/schema.ts` and `src/lib/types.ts`; changing either affects other streams, so stop
and flag it rather than changing it unilaterally.

- **platform** — `src/app/(auth)`, `src/app/api/games`, `src/lib/games`, `src/db`
- **imagegen** — `src/lib/generation`, `src/app/api/generate`
- **canvas** — `src/components/canvas`, `src/app/g/[publicId]`
