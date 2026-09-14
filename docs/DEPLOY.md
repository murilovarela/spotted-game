# Deploy

Procedure for shipping Spotted to production on Vercel. The Vercel project is already
linked (`.vercel/` — git-ignored, created by `vercel link`) and the repository is
connected to it, so `main` deploys itself. The CLI is not a dependency — it drags in
dozens of `npm audit` advisories and the audit gate would fail — so the manual commands
below run through `npx vercel`, which fetches it on demand.

An agent never holds `.env*` (see `CLAUDE.md` protected paths). Steps 3 and 4 are run by
the project owner from their own shell.

## 1. Environment variables

Set in the Vercel dashboard (Project → Settings → Environment Variables), **Production**
scope, before the first deploy that needs them.

| Variable | Value / where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon **main** branch, pooled connection string (currently the dev branch — see §4) |
| `DATABASE_URL_UNPOOLED` | Same branch as `DATABASE_URL`, direct (unpooled) connection string |
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

`.env.example` documents the same variables for local development; this table maps each to
its production source.

## 2. Bucket CORS

Nothing to do: the `assets` bucket is configured with `AllowedOrigins: ["*"]` (verified with
`GetBucketCors` and a preflight from a `vercel.app` origin), so presigned PUT/GET work from
any deployment origin. If that ever changes, the symptom is a CORS error in the browser on
upload with a valid presigned URL.

## 3. Deploy

Production domain: `https://spotted.murilovarela.dev` (attached to the project; the parent
zone is on Vercel nameservers, so no DNS records are needed).

The repository is linked to the Vercel project: every merge to `main` builds and deploys
production; every other branch gets a preview deployment. Nothing to run. The first
deployment (before the link existed) was pushed from the CLI, which remains the manual
path if the integration is ever off:

```bash
npx vercel --prod
```

Deploying alone does not touch the database or the bucket — the app deploys, but a fresh
production database has no schema and no data yet, so nothing will work until steps 4–5
run.

## 4. Migrate + verify

**Which database is production.** The env table says the Neon **main** branch; at the time
of writing production shares the development branch (`DATABASE_URL` is the same string in
`.env.local` and in Vercel). Until that changes, every local `npm run seed` and
`npm run test:e2e` is a production mutation: the seed deletes and recreates every
`[seed] …` game under `SEED_MASTER_ID`, and Playwright's global setup runs that seed under
the Clerk e2e user, then `author.spec` publishes the seeded draft. Move production to its
own branch before opening the site to anyone else.

The owner runs the migration directly, from their own shell, with the values from step
1's env vars (the agent never sees them). `db:migrate` needs the unpooled connection
because migrations hold a session:

```bash
DATABASE_URL_UNPOOLED=<unpooled> npm run db:migrate
```

Then run the Playwright suite against the live deployment. `PLAYWRIGHT_BASE_URL` switches
`playwright.config.ts` into remote mode (no local server is started; `generate.spec.ts`
skips itself since generation against a live server would call Gemini for real).
`DATABASE_URL` must point at the same database the deployment uses, since global setup
seeds through it directly — and that seed runs as the e2e user, which is why the owner's
seed comes *after* this step, not before:

```bash
PLAYWRIGHT_BASE_URL=<url> DATABASE_URL=<pooled> npm run test:e2e
```

## 5. Seed as the owner (owner only — never run by an agent), then a manual pass

Last, so the §9.2 demo set (one game in every lifecycle state) belongs to the owner and
none of it has been played or published by the test run:

```bash
DATABASE_URL=<pooled> SEED_MASTER_ID=<clerk id> npm run seed
```

`seed` uses the pooled connection, matching how the app itself connects at runtime.
Re-run it after any later `npm run test:e2e` against this database.

Then one manual pass from a second Google account (SPEC §9.1): sign in, play a published
game end to end, confirm scoring and timing behave as a real second player would see them
— something the seeded Clerk test user's automated run doesn't cover. And one real
generation from the owner's account, which is the first time `sharp` and Gemini run on
Vercel.

## 6. Rollback

If the deployment is bad, revert to the previous one:

```bash
npx vercel rollback
```

This points production traffic back at the prior deployment; it does not revert the
database. If the bad deploy included a migration, decide separately whether the schema
change needs to be rolled back too — `db:migrate` has no automatic down migration.
