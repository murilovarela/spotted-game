# Phase 4 — Integration and Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app safe to deploy with a live Gemini key (stable image URLs, per-user generation cap, stale rows finalized), deploy it to Vercel, verify it live, and bring `README.md`/`SYSTEM.md` to SPEC §9 accuracy.

**Architecture:** Three small code changes inside existing modules (`storage.presignGet`, `startGeneration`, `playwright.config.ts`), then a procedural deploy driven by the Vercel CLI with the owner supplying secrets, then docs and the review pass.

**Tech Stack:** Vercel CLI, `@aws-sdk/s3-request-presigner` `signingDate`, Drizzle, Playwright.

**Spec:** `docs/specs/2026-09-14-phase-4-deploy-design.md`; `docs/SPEC.md` §7 Phase 4, §9; handoffs `docs/handoffs/phase-2.md`, `phase-3.md`.

## Global Constraints

- Node `22.23.2`; `npm run verify` green before every commit; coverage on `npm run test:cov` ≥ **99.46** (`quality-baseline.json`); jscpd 0; knip 0.
- Frozen: `src/db/schema.ts`, `src/lib/types.ts`, `src/lib/visibility.ts`, `src/lib/scoring.ts`. `src/lib/games/**` untouched. Drizzle only, no raw SQL.
- Agents never read or write `.env*` (except `.env.example`) and never handle production secrets: migrations and the seed against production are run by the owner through `!` commands; env vars are entered in the Vercel dashboard by the owner.
- TypeScript strict, no `any`, no non-null assertions. Colocated tests. Integration tests need `TEST_DATABASE_URL`.
- Commit after every task with this exact two-line footer, nothing else in the footer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB`

---

### Task 1: Stable presigned GET URLs

**Files:**
- Modify: `src/lib/storage.ts`
- Test: `src/lib/__tests__/storage.test.ts` (extend)

**Interfaces:**
- Produces: `hourBucket(now: Date): Date` (pure, exported); `presignGet(key, now = new Date())` signs with `{ expiresIn: 7200, signingDate: hourBucket(now) }`.

- [ ] **Step 1: Failing test** — append to `src/lib/__tests__/storage.test.ts`:

```ts
import { hourBucket, presignGet } from "../storage";

describe("hourBucket", () => {
  it("floors to the hour in UTC", () => {
    expect(hourBucket(new Date("2026-09-14T13:59:59.999Z")).toISOString()).toBe("2026-09-14T13:00:00.000Z");
    expect(hourBucket(new Date("2026-09-14T14:00:00.000Z")).toISOString()).toBe("2026-09-14T14:00:00.000Z");
  });
});

describe("presignGet", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_ENDPOINT_URL_S3: "https://storage.example.test", AWS_REGION: "us-east-1" };
  });
  afterEach(() => {
    process.env = env;
  });
  it("is byte-identical within the same hour and differs across hours", async () => {
    const a = await presignGet("games/g/generated/x.png", new Date("2026-09-14T13:01:00Z"));
    const b = await presignGet("games/g/generated/x.png", new Date("2026-09-14T13:58:00Z"));
    const c = await presignGet("games/g/generated/x.png", new Date("2026-09-14T14:01:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("X-Amz-Expires=7200");
  });
});
```

If `storage.test.ts` already builds an S3 client from env in another way, reuse that setup; the point is: same key + same hour ⇒ same URL. Note the module caches its `S3Client` (`client ??=`); if the client was created before the env stub, export a `resetStorageClientForTests()` or construct the test env before the first import — pick the smaller change and say which.

- [ ] **Step 2: Implement** — in `src/lib/storage.ts`:

```ts
/** Floors to the hour so presigned URLs are stable across renders (browser cache hits). */
export function hourBucket(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}

/**
 * Signed against the current hour bucket with a 2 h lifetime: every render inside the same
 * hour yields byte-identical URLs (so polling pages do not refetch every image), and a URL
 * minted at :59 stays valid for at least an hour.
 */
export function presignGet(key: string, now: Date = new Date()): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 7200, signingDate: hourBucket(now) });
}
```

`urlResolverFor` keeps calling `presignGet(key)`.

- [ ] **Step 3: Verify, commit** — `npm run verify && npm run test:cov 2>&1 | grep "All files"`.

```bash
git add src/lib/storage.ts src/lib/__tests__/storage.test.ts
git commit -m "feat(storage): hour-bucketed presigned GET URLs so polling pages stop refetching images

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 2: Generation guard — stale finalization, one loop per master, daily cap

**Files:**
- Modify: `src/lib/generation/run.ts`, `src/lib/generation/actions.ts`, `.env.example`
- Test: `src/lib/generation/__tests__/run.integration.test.ts` (extend)

**Interfaces:**
- Produces: `startGeneration(db, user, gameId, now, opts: { dailyCap: number } = { dailyCap: DEFAULT_DAILY_CAP })`; `DEFAULT_DAILY_CAP = 20` and `dailyCapFromEnv(env)` in `run.ts`; messages exactly: `"A generation is already running on another of your games"`, `` `Daily generation limit reached (${cap} attempts per 24 h)` ``.

- [ ] **Step 1: Failing integration tests** — add to `run.integration.test.ts` (reuse its `draft()` helper and `paste` runs):

```ts
describe("startGeneration guards", () => {
  it("finalizes a stale run before starting a new one", async () => {
    const id = await draft(master);
    const stale = await startGeneration(db, master, id, new Date(Date.now() - 11 * 60_000));
    if (!stale.ok) throw new Error(stale.message);
    const next = await startGeneration(db, master, id, new Date());
    expect(next.ok).toBe(true);
    const rows = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id)).orderBy(generationRuns.attemptNumber);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failureReason).toBe(STALE_REASON);
    expect(rows[0].finishedAt).not.toBeNull();
    expect(rows[1].status).toBe("queued");
  });
  it("refuses a second loop while one is running on another of the master's games", async () => {
    const a = await draft(master);
    const b = await draft(master);
    expect((await startGeneration(db, master, a, new Date())).ok).toBe(true);
    expect(await startGeneration(db, master, b, new Date())).toMatchObject({ ok: false, error: "INVALID_INPUT", message: "A generation is already running on another of your games" });
  });
  it("enforces the daily cap across the master's games", async () => {
    const a = await draft(master);
    const paste = createPasteBackend();
    for (let i = 0; i < 2; i++) {
      const s = await startGeneration(db, master, a, new Date(), { dailyCap: 2 });
      if (!s.ok) throw new Error(s.message);
      await runGeneration(db, a, s.data.runId, { ok: true, backend: paste }, deps);
    }
    expect(await startGeneration(db, master, a, new Date(), { dailyCap: 2 })).toMatchObject({ ok: false, message: "Daily generation limit reached (2 attempts per 24 h)" });
    // another master is unaffected
    const [other] = await db.insert(users).values({ id: "m2", email: "m2@test", name: "M2" }).returning();
    const c = await draft(other);
    expect((await startGeneration(db, other, c, new Date(), { dailyCap: 2 })).ok).toBe(true);
  });
});
```

Import `STALE_REASON` from `../status` and `users` from `@/db/schema`. Note `runGeneration` on a passed game sets the image; the second loop on the same game after a pass is allowed (draft, not published) — that is what the loop above relies on.

- [ ] **Step 2: Implement** — in `run.ts`, inside `startGeneration`'s transaction after the object check:

```ts
export const DEFAULT_DAILY_CAP = 20;
export function dailyCapFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.GENERATION_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}
```

```ts
    // 1. A stale run on this game is finalized here so the evidence table matches the panel.
    const runs = await tx.select().from(generationRuns).where(eq(generationRuns.gameId, gameId));
    const state = deriveGenerationState(runs, now);
    if (state.kind === "running") return fail("INVALID_INPUT", "A generation is already running");
    if (state.kind === "failed" && state.reason === STALE_REASON) {
      const staleRow = runs.find((r) => r.attemptNumber === state.attemptNumber);
      if (staleRow && (staleRow.status === "running" || staleRow.status === "queued")) {
        await tx
          .update(generationRuns)
          .set({ status: "failed", failureReason: STALE_REASON, finishedAt: now, durationMs: now.getTime() - staleRow.startedAt.getTime() })
          .where(eq(generationRuns.id, staleRow.id));
      }
    }
    // 2. One live loop per master, across all their games.
    const liveElsewhere = await tx
      .select({ id: generationRuns.id, startedAt: generationRuns.startedAt })
      .from(generationRuns)
      .innerJoin(games, eq(games.id, generationRuns.gameId))
      .where(and(eq(games.masterId, user.id), ne(generationRuns.gameId, gameId), inArray(generationRuns.status, ["queued", "running"])));
    if (liveElsewhere.some((r) => now.getTime() - r.startedAt.getTime() <= STALE_AFTER_MS)) {
      return fail("INVALID_INPUT", "A generation is already running on another of your games");
    }
    // 3. Daily cap per master.
    const [{ n }] = await tx
      .select({ n: count() })
      .from(generationRuns)
      .innerJoin(games, eq(games.id, generationRuns.gameId))
      .where(and(eq(games.masterId, user.id), gte(generationRuns.startedAt, new Date(now.getTime() - 24 * 3_600_000))));
    if (n >= opts.dailyCap) return fail("INVALID_INPUT", `Daily generation limit reached (${opts.dailyCap} attempts per 24 h)`);
```

Imports: `and, count, eq, gte, inArray, ne` from `drizzle-orm`; `STALE_AFTER_MS` from `./types`; `STALE_REASON` from `./status`. Signature: `startGeneration(db, user, gameId, now, opts: { dailyCap: number } = { dailyCap: DEFAULT_DAILY_CAP })`. In `actions.ts`: `startGeneration(getDb(), user, gameId, new Date(), { dailyCap: dailyCapFromEnv() })`. `.env.example`: `GENERATION_DAILY_CAP=20` with a one-line comment under the generation block.

- [ ] **Step 3: Verify, commit** — `npm run test:integration -- src/lib/generation && npm run verify && npx knip`.

```bash
git add src/lib/generation .env.example
git commit -m "feat(generation): finalize stale runs, one loop per master, daily cap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 3: Remote Playwright mode, Vercel CLI, deploy doc

**Files:**
- Modify: `playwright.config.ts`, `e2e/generate.spec.ts`, `package.json` (`vercel` devDependency), `knip.json` if needed
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Config** — `playwright.config.ts`:

```ts
const REMOTE = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = REMOTE ?? "http://localhost:3000";
export default defineConfig({
  …,
  use: { baseURL, storageState: "e2e/.auth/user.json", trace: "retain-on-failure" },
  // Against a deployed app (PLAYWRIGHT_BASE_URL) there is no server to start; the seed
  // still runs against DATABASE_URL, which must then be the deployment's database.
  webServer: REMOTE ? undefined : { …existing… },
});
```

`e2e/generate.spec.ts`: `test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "generation against a live server would call Gemini");` as the first line inside the test (or `test.describe.configure`). `e2e/global-setup.ts`: use `config.projects[0]?.use.baseURL` as it already does — confirm it does not hard-code localhost.

- [ ] **Step 2: Vercel CLI + doc** — `npm install -D vercel`; `docs/DEPLOY.md` with the procedure from the design (env var table with which Neon branch/instance each comes from, bucket CORS, `npx vercel --prod`, owner-run migrate/seed commands, verification commands, rollback = `npx vercel rollback`). `knip.json`: `vercel` is a CLI dep — if knip flags it unused, add to `ignoreDependencies`.

- [ ] **Step 3: Verify, commit** — `npm run verify && npx knip`; `npm run test:e2e` still 8/8 locally (no `PLAYWRIGHT_BASE_URL`).

```bash
git add playwright.config.ts e2e package.json package-lock.json knip.json docs/DEPLOY.md
git commit -m "chore(deploy): remote Playwright mode, Vercel CLI, deploy runbook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 4: README and SYSTEM.md accuracy

**Files:**
- Rewrite: `README.md`
- Modify: `docs/SYSTEM.md` §4.3, §4.4, §7 (corrections table)
- Create: `docs/evidence/timeline.md`

- [ ] **Step 1: `docs/evidence/timeline.md`** — generated from git: for each of `stream/platform`, `stream/canvas`, `stream/imagegen`, `phase-4/*`: first commit time, last commit time, merge commit + time, commit count (use `git log --first-parent main --merges` and `git log <merge>^2 --reverse`). State plainly that the streams ran **sequentially** (A → C → B), one session each, each inside the same brief → implement → review → fix loop, and that the parallel-worktree plan in §4.1 was not exercised.

- [ ] **Step 2: `docs/SYSTEM.md`** — §4.3: replace the two non-existent references with the timeline file and the sequential statement; §4.4: order "A, then C, then B" and the gate ("full suite + integration-reviewer per merge"); §7 corrections table: add a row "Parallel streams claimed, sequential streams delivered — corrected in §4.3/§4.4 during Phase 4".

- [ ] **Step 3: `README.md`** — sections: title + one-paragraph what/why; Stack (table from SPEC §5.1); Local setup (clone, Node 22.23.2 via `.nvmrc`, `cp .env.example .env.local`, Neon: `npx neon env pull`/branch, Clerk dev instance Google-only, bucket CORS, `npm run db:migrate`, `npm run seed`, `npm run dev`); Commands (the CLAUDE.md table); Testing and CI (unit/integration/e2e/eval, the ratchet, `quality-baseline.json`); Deploy (pointer to `docs/DEPLOY.md`); Docs map (SPEC, SYSTEM, AI-DEV-LOG, handoffs, specs, plans); Invariants (pointer to CLAUDE.md, one line each). No marketing copy.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/SYSTEM.md docs/evidence
git commit -m "docs: README for the finished product; SYSTEM.md tells the sequential-stream truth

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 5 (controller + owner): Deploy and verify

Not a subagent task. Order:
1. Owner enters Production env vars in the Vercel dashboard from `docs/DEPLOY.md`; adds the Vercel origin to the bucket CORS.
2. Controller: `npx vercel --prod` → URL; `curl -sI <url>` 200; `/g/does-not-exist` 404; `/sign-in` renders.
3. Owner: `! DATABASE_URL_UNPOOLED=… npm run db:migrate` then `! DATABASE_URL=… SEED_MASTER_ID=… npm run seed` (prints the demo URLs).
4. Owner: `! PLAYWRIGHT_BASE_URL=<url> DATABASE_URL=… npm run test:e2e` (7 specs; generate skipped). Controller reads the output.
5. Owner: one manual play from a second Google account; report what was seen.

### Task 6 (controller): Review pass and close-out

`/check-invariants`, `/security-review` on the branch; `integration-reviewer` with the live URL; fix CRITICAL/HIGH; `/phase-handoff` (handoff `docs/handoffs/phase-4.md`, dev-log entry incl. the deploy story and anything that broke); PR; merge on green.

---

## Self-review

Spec coverage: URLs → T1; cap/stale → T2; remote E2E + CLI + runbook → T3; README/SYSTEM/evidence → T4; deploy + verify → T5; review + handoff → T6. Type consistency: `startGeneration`'s new `opts` used identically in T2 tests and `actions.ts`; `hourBucket` exported and tested; `PLAYWRIGHT_BASE_URL` read in config and spec. No placeholders (T5/T6 are procedural by design).
