# Deploy

Procedure for shipping Spotted to production on Vercel. The Vercel project is already
linked (`.vercel/` — git-ignored, created by `vercel link`). The CLI is a pinned
devDependency (`npm install -D vercel`), so every step below runs through `npx vercel` —
never a globally installed CLI, so the version is reproducible.

An agent never holds `.env*` (see `CLAUDE.md` protected paths). Steps 3 and 4 are run by
the project owner from their own shell.

## 1. Environment variables

Set in the Vercel dashboard (Project → Settings → Environment Variables), **Production**
scope, before the first deploy that needs them.

| Variable | Value / where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon **main** branch, pooled connection string |
| `DATABASE_URL_UNPOOLED` | Neon **main** branch, direct (unpooled) connection string |
| `AWS_ACCESS_KEY_ID` | Neon Object Storage credential for the `assets` bucket |
| `AWS_SECRET_ACCESS_KEY` | Neon Object Storage credential for the `assets` bucket |
| `AWS_ENDPOINT_URL_S3` | Neon Object Storage S3-compatible endpoint |
| `AWS_REGION` | Neon Object Storage region |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dev instance |
| `CLERK_SECRET_KEY` | Clerk dev instance |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `GEMINI_API_KEY` | Google AI Studio |
| `GEMINI_IMAGE_MODEL` | Google AI Studio (Nano Banana family, e.g. `gemini-3.1-flash-image`) |
| `GEMINI_VISION_MODEL` | Google AI Studio (e.g. `gemini-3.6-flash`) |
| `GENERATION_MODE` | `gemini` (production calls the real backend, unlike CI's `paste`) |
| `GENERATION_DAILY_CAP` | `20` |
| `NEXT_PUBLIC_APP_URL` | `https://<project>.vercel.app` (the Vercel production URL) |

`.env.example` documents the same variables for local development; this table maps each to
its production source.

## 2. Bucket CORS

The `assets` bucket only accepts browser requests (presigned PUT/GET) from origins in its
`AllowedOrigins` list. Add the Vercel production origin:

Neon dashboard → Storage → bucket `assets` → CORS → **AllowedOrigins** → add
`https://<project>.vercel.app`.

Without this step, uploads and image loads fail with a CORS error in the browser even
though the presigned URL itself is valid.

## 3. Deploy (agent)

```bash
npx vercel --prod
```

Prints the deployment URL. This step alone does not touch the database or the bucket — the
app deploys, but a fresh production database has no schema and no data yet, so nothing
will work until step 4 runs.

## 4. Migrate + seed (owner only — never run by an agent)

The owner runs these directly, from their own shell, with the values from step 1's env
vars (the agent never sees them):

```bash
DATABASE_URL_UNPOOLED=<unpooled> npm run db:migrate
DATABASE_URL=<pooled> SEED_MASTER_ID=<clerk id> npm run seed
```

`db:migrate` needs the unpooled connection because migrations hold a session; `seed` uses
the pooled one, matching how the app itself connects at runtime.

## 5. Verify

Run the Playwright suite against the live deployment. `PLAYWRIGHT_BASE_URL` switches
`playwright.config.ts` into remote mode (no local server is started; `generate.spec.ts`
skips itself since generation against a live server would call Gemini for real).
`DATABASE_URL` must point at the same database the deployment uses, since global setup
seeds through it directly:

```bash
PLAYWRIGHT_BASE_URL=<url> DATABASE_URL=<pooled> npm run test:e2e
```

Then one manual pass from a second Google account (SPEC §9.1): sign in, play a published
game end to end, confirm scoring and timing behave as a real second player would see them
— something the seeded Clerk test user's automated run doesn't cover.

## 6. Rollback

If the deployment is bad, revert to the previous one:

```bash
npx vercel rollback
```

This points production traffic back at the prior deployment; it does not revert the
database. If the bad deploy included a migration, decide separately whether the schema
change needs to be rolled back too — `db:migrate` has no automatic down migration.
