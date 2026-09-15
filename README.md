# Spotted

A hidden-object game platform. A game master composes a puzzle from a background image
and up to five object images, using generative AI to blend the objects into the scene;
players then find them against the clock and appear on a leaderboard. Full product
specification: [`docs/SPEC.md`](./docs/SPEC.md). Engineering system that built it:
[`docs/SYSTEM.md`](./docs/SYSTEM.md).

**Demo:** [`docs/demo.mp4`](./docs/demo.mp4) — a master builds a game from a photo and
three objects, publishes it, and a player hunts them down against the clock.

## Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js (App Router) | Server actions keep scoring server-side by default |
| Hosting | Vercel | Zero-config preview deploys give the agent a verifiable artifact |
| Auth | Clerk (free tier), Google only | Removes session handling from scope entirely |
| Database | Neon Postgres + Drizzle | Typed schema is the shared contract between workstreams |
| Blob storage | Neon Object Storage (S3-compatible) | Same vendor as the database; buckets branch with the project; signed URLs for unpublished assets |
| Generation | Nano Banana (Gemini image) | Strongest subject-consistency when compositing a supplied object |
| Detection | Gemini vision, constrained by pixel diff | See `docs/SPEC.md` §5.3 |

## Local setup

```bash
git clone <repo> && cd spotted
nvm use                      # or install Node per .nvmrc / .tool-versions (22.23.2)
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- **Neon Postgres** — `npx neon env pull` against your project (or copy from the Neon
  dashboard), or create a branch first if you don't want to touch the shared dev branch.
  Populates `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`.
- **Neon Object Storage** — the `assets` bucket's S3-compatible credentials:
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`.
  CORS is already permissive (`AllowedOrigins: ["*"]`); nothing to configure there.
- **Clerk** — create a dev instance, restrict sign-in to Google only, and set
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` (`NEXT_PUBLIC_CLERK_SIGN_IN_URL`
  and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` already default to `/sign-in` / `/sign-up`).
- **Gemini** — `GEMINI_API_KEY` from Google AI Studio, plus `GEMINI_IMAGE_MODEL` /
  `GEMINI_VISION_MODEL`. `GENERATION_MODE=paste` composites deterministically with no API
  call (what CI uses); `gemini` calls the real backend.

Then:

```bash
npm run db:migrate
npm run seed                 # demo games in all four lifecycle states
npm run dev
```

### Try it with the example images

`docs/example-images/` holds a ready-made set so you can exercise the whole flow without
hunting for pictures:

| File | Use as |
| --- | --- |
| `busy-city.webp` | Background — a portrait street scene with plenty of places to hide things |
| `bob.jpg`, `kiki.jpg`, `panqueca.jpg` | Objects — one upload each |

Sign in, **New game**, upload `busy-city.webp` as the background, add the three objects
(a label and, optionally, a prompt such as "sitting on a windowsill, small"), press
**Generate**, drag and confirm each circle in *Confirm positions*, set a play window, and
**Publish**. Open the `/g/…` link from a second Google account to play. With
`GENERATION_MODE=paste` the objects are pasted in deterministically; with `gemini` the
model hides them.

## Commands

| | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run verify` | Typecheck + lint + unit. What the Stop hook runs. |
| `npm run test:e2e` | Playwright |
| `npm run test:integration` | Vitest against a real Neon branch (publish transaction, double-submit, timing, leaderboard visibility) |
| `npm run test:cov` | Unit tests with v8 coverage |
| `npm run lint:dup` | jscpd duplication check |
| `npm run lint:unused` | knip — unused files, exports, types, deps |
| `npm run eval:generation` | Generation quality against the golden set |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply tracked migrations. Use this; `db:push` skips migration history |
| `npm run seed` | Demo games in all four lifecycle states |

## Testing and CI

Four layers, in increasing cost: unit tests (Vitest) for scoring, status derivation, and
validation predicates; integration tests (Vitest + a disposable Neon branch) for the
publish transaction and leaderboard visibility; Playwright E2E for the full authoring and
play flows; and an on-demand generation eval against a golden set. `npm run verify`
(typecheck + lint + unit) is what the local `Stop` hook runs and must be green before a
turn ends.

CI (`.github/workflows/ci.yml`) runs ten gate jobs on every pull request and on every push
to `main`: lint, typecheck, test (with coverage), secrets (gitleaks), audit (`npm audit`),
duplication (jscpd), security (semgrep `p/security-audit`), and unused (knip) in parallel,
then integration (against a Neon branch) and e2e (Playwright) in sequence. Each numeric job
compares against a floor or ceiling in `quality-baseline.json` and fails if the current
run is worse than the baseline — a ratchet, not a fixed threshold. After a fully green run
on `main`, `update-baseline` rewrites `quality-baseline.json` with the measured values and
commits it, so the baseline only ever reflects what the gate actually measured.

## Deploy

Production: `https://spotted.murilovarela.dev`. Procedure, environment variables, and
rollback: [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Docs map

| Doc | Contents |
| --- | --- |
| [`docs/SPEC.md`](./docs/SPEC.md) | Product requirements, architecture, acceptance criteria |
| [`docs/SYSTEM.md`](./docs/SYSTEM.md) | The engineering system that built this: agents, hooks, harness, orchestration |
| [`docs/DEPLOY.md`](./docs/DEPLOY.md) | Deploy procedure, environment variables, rollback |
| [`docs/AI-DEV-LOG.md`](./docs/AI-DEV-LOG.md) | Session-by-session development log — decisions, failures, recoveries |
| [`docs/handoffs/`](./docs/handoffs) | Per-phase handoff notes: what was built, what contracts it exposes, what the next phase must not break |
| [`docs/specs/`](./docs/specs) | Per-phase design specs |
| [`docs/plans/`](./docs/plans) | Per-phase implementation plans |
| [`docs/evidence/`](./docs/evidence) | Evidence artifacts referenced from `SYSTEM.md` (e.g. the stream timeline) |
| `CLAUDE.md` | Invariants, conventions, commands, protected paths — the project's agent instructions |

## Invariants

See `CLAUDE.md` for full detail. One line each:

1. Coordinates never reach the client while a game is `active`.
2. All coordinates are normalized `[0,1]` against the generated image, never pixels.
3. Game status is derived on read from `starts_at` / `ends_at` / `published_at` — no status column, no scheduler.
4. A game cannot be published with an unconfirmed object.
5. Elapsed time is server-anchored; the client's clock is never trusted.
6. All timestamps are UTC; conversion happens only at the display boundary.
