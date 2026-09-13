# Phase 1 — Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auth, game authoring CRUD, publish, play-side server actions, and routing — Stream A of SPEC §7 — verified by integration tests against a real Neon database.

**Architecture:** Thin `"use server"` wrappers resolve the Clerk user and delegate to pure-ish core functions that take `(db, user, input)`, so integration tests exercise the real logic against a real database without a request context. Every read of game data goes through `projectGame`; every mutation returns a typed `ActionResult`, never throws across the action boundary. Images go browser → presigned S3 PUT; the app only ever handles keys.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts`), Clerk 7 (`@clerk/nextjs`), Drizzle + `@neondatabase/serverless` `Pool` (WebSocket, transactions), `@aws-sdk/client-s3` + `s3-request-presigner`, Vitest.

**Spec:** `docs/SPEC.md` §3.1–3.4, §5, §8, §11. Handoff: `docs/handoffs/phase-0.md`. Design as approved in chat (2026-09-13): lazy user upsert, presigned PUT, play actions in Phase 1, dedicated Neon `ci` branch.

## Global Constraints

- Node `>=22.12.0`; run `npm run verify` before every commit (Stop hook runs it).
- TypeScript strict, no `any`. Drizzle only; no raw SQL outside migrations (`sql\`\`` fragments inside Drizzle queries are fine).
- **Frozen contract:** `src/db/schema.ts`, `src/lib/types.ts`, `src/lib/visibility.ts`. Do not edit. If a task seems to need it, stop and flag.
- **Invariant 1:** game data reaches a client only via `projectGame`. Never return an `objects` row or `x/y/radius` from an action or page.
- **Invariant 5:** never write `elapsed_ms`; never accept a client timestamp for `started_at`/`submitted_at`.
- **Handoff rules:** submit = `UPDATE … WHERE submitted_at IS NULL`, rowCount 0 → reject. Any write to `objects.x/y/radius` sets `confirmed = false`. `db:migrate`, never `db:push`.
- Stream A owns `src/app/(auth)`, `src/app/(master)`, `src/app/api/games`, `src/lib/games`, `src/lib/auth.ts`, `src/lib/storage.ts`, `src/db`, `src/proxy.ts`. Do not create files under `src/components/canvas`, `src/app/g`, `src/lib/generation`.
- Colocate tests as `__tests__/*.test.ts` (unit, in ratchet) and `__tests__/*.integration.test.ts` (real DB, separate script).
- All timestamps UTC in the DB; convert at the display boundary only.
- Commit after every task with the attribution footer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/db/index.ts` | Singleton `db` (neon-serverless Pool + schema); `Database` type |
| `src/db/test.ts` | `createTestDb()`, `truncateAll()` for integration tests; refuses to run without `TEST_DATABASE_URL` |
| `vitest.integration.config.ts` | Includes only `*.integration.test.ts`, single-threaded |
| `src/lib/auth.ts` | `toUserRow()` (pure), `getCurrentUser()` (Clerk → upsert `users`) |
| `src/lib/storage.ts` | S3 client, `objectKey()` (pure), `presignPut()`, `presignGet()` (= `resolveUrl`) |
| `src/lib/games/result.ts` | `ActionResult<T>`, `ActionError`, `ok()`, `fail()` |
| `src/lib/games/validation.ts` | Pure: window, publish preconditions, marker count, title/label/prompt bounds |
| `src/lib/games/games.ts` | Core authoring: create/update/delete game, add/update/remove/confirm object, publish/unpublish |
| `src/lib/games/play.ts` | Core play: start, submit (scores), player state, leaderboard |
| `src/lib/games/queries.ts` | `loadGameForViewer()` → `projectGame`; `listGamesForMaster()` |
| `src/lib/games/actions.ts` | `"use server"` wrappers: resolve user, call core, `revalidatePath` |
| `src/lib/games/upload.ts` | `"use server"`: `requestUploadUrl()` |
| `src/proxy.ts` | `clerkMiddleware`; public routes `/`, `/g/(.*)`, `/sign-in`, `/sign-up` |
| `src/app/layout.tsx` | wrap in `<ClerkProvider>` (modify) |
| `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `sign-up/…` | Clerk components |
| `src/app/(master)/games/page.tsx` | My games list |
| `src/app/(master)/games/new/page.tsx` | Create form |
| `src/app/(master)/games/[id]/page.tsx` | Edit: objects, uploads, confirm, publish |
| `src/app/(master)/games/[id]/*.tsx` | Client components: `UploadField`, `WindowFields` |
| `.github/workflows/ci.yml` | add `integration` job (modify) |
| `.env.example` | add `TEST_DATABASE_URL`, `NEXT_PUBLIC_APP_URL` (modify) |

---

### Task 1: Database client and integration-test harness

**Files:**
- Create: `src/db/index.ts`, `src/db/test.ts`, `vitest.integration.config.ts`
- Modify: `vitest.config.ts`, `package.json` (scripts), `.env.example`, `knip.json`
- Test: `src/db/__tests__/client.integration.test.ts`

**Interfaces:**
- Produces: `db: Database` (singleton), `type Database`, `createTestDb(): { db: Database; close(): Promise<void> }`, `truncateAll(db): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

`src/db/__tests__/client.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "../schema";
import { createTestDb, truncateAll } from "../test";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

describe("test database", () => {
  it("is empty after truncateAll", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com" });
    await truncateAll(db);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("runs a transaction that rolls back on error", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(users).values({ id: "u1", email: "u1@example.com" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("reads timestamps back as UTC Dates", async () => {
    const [row] = await db.execute(sql`select now() as now`).then((r) => r.rows as { now: Date }[]);
    expect(row.now).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Add the integration vitest config and script; run to see it fail**

`vitest.integration.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Real database. Not part of `verify`; run with `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false, // tests truncate shared tables
    testTimeout: 20_000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
```

In `vitest.config.ts` add `exclude: ["**/*.integration.test.ts"]` next to `include` inside `test`.

```bash
npm pkg set scripts.test:integration="vitest run --config vitest.integration.config.ts"
npm run test:integration
```
Expected: FAIL — cannot resolve `../test`.

- [ ] **Step 3: Write the client and test helpers**

`src/db/index.ts`:
```ts
/**
 * Application database handle. Uses the WebSocket driver so transactions work
 * (the HTTP driver cannot hold a session — see docs/handoffs/phase-0.md).
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema, casing: "snake_case" });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Lazy so importing this module in a unit test does not open a socket.
let singleton: Database | undefined;
export function getDb(): Database {
  singleton ??= createDb(required("DATABASE_URL"));
  return singleton;
}
```
Note: `casing: "snake_case"` is harmless because every column names itself explicitly; remove the option if drizzle's version rejects it.

`src/db/test.ts`:
```ts
/**
 * Integration-test database. Points at TEST_DATABASE_URL only — never DATABASE_URL —
 * because these helpers truncate every table.
 */
import { sql } from "drizzle-orm";
import { createDb, type Database } from "./index";

export function createTestDb(): { db: Database; close: () => Promise<void> } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a disposable Neon branch; integration tests truncate tables.",
    );
  }
  const db = createDb(url);
  return { db, close: () => db.$client.end() };
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table markers, attempts, generation_runs, objects, games, users restart identity cascade`,
  );
}
```

`.env.example` — append:
```
# --- Integration tests ---
# A disposable Neon branch. Tests TRUNCATE every table here. Never the dev or prod branch.
TEST_DATABASE_URL=
```

`knip.json` — add `"src/db/test.ts"` to `entry` is NOT needed (it is imported by tests); add `"vitest.integration.config.ts"` to `entry`.

- [ ] **Step 4: Point TEST_DATABASE_URL at a branch and run**

The user creates a Neon branch named `test` and puts its pooled URL in `.env.local` as `TEST_DATABASE_URL`, then runs `npm run db:migrate` against it: `DATABASE_URL_UNPOOLED=<test-branch-direct-url> npx drizzle-kit migrate`.

Run: `npm run test:integration`
Expected: 3 passed.

- [ ] **Step 5: Verify and commit**

```bash
npm run verify && git add -A && git commit -m "feat(platform): db client, integration-test harness

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Result type and pure validation

**Files:**
- Create: `src/lib/games/result.ts`, `src/lib/games/validation.ts`
- Test: `src/lib/games/__tests__/validation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ActionError = "UNAUTHENTICATED" | "NOT_FOUND" | "NOT_MASTER" | "INVALID_INPUT"
    | "NOT_DRAFT" | "NO_OBJECTS" | "TOO_MANY_OBJECTS" | "NO_IMAGE" | "UNCONFIRMED_OBJECTS"
    | "INVALID_WINDOW" | "NOT_ACTIVE" | "MASTER_CANNOT_PLAY" | "NOT_STARTED"
    | "ALREADY_SUBMITTED" | "WRONG_MARKER_COUNT" | "LEADERBOARD_HIDDEN";
  type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError; message: string };
  ok<T>(data: T): ActionResult<T>; fail(error: ActionError, message: string): ActionResult<never>;
  validateTitle(s: string): ActionResult<string>            // trimmed, 1..120 chars
  validateLabel(s: string): ActionResult<string>            // trimmed, 1..60
  validatePrompt(s: string): ActionResult<string>           // trimmed, 0..500
  validateWindow(startsAt: Date, endsAt: Date, now: Date): ActionResult<{ startsAt: Date; endsAt: Date }>
  publishPreconditions(game: PublishGameSource, objects: PublishObjectSource[]): ActionResult<null>
  validateMarkerCount(markerCount: number, objectCount: number): ActionResult<null>
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/games/__tests__/validation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  publishPreconditions,
  validateLabel,
  validateMarkerCount,
  validatePrompt,
  validateTitle,
  validateWindow,
} from "../validation";

const now = new Date("2026-09-13T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);

describe("validateTitle", () => {
  it("trims and accepts 1..120 chars", () => {
    expect(validateTitle("  Kitchen  ")).toEqual({ ok: true, data: "Kitchen" });
    expect(validateTitle("x".repeat(120)).ok).toBe(true);
  });
  it("rejects empty and too long", () => {
    expect(validateTitle("   ")).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(validateTitle("x".repeat(121))).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("validateLabel / validatePrompt", () => {
  it("label 1..60, prompt 0..500", () => {
    expect(validateLabel("mug")).toEqual({ ok: true, data: "mug" });
    expect(validateLabel("")).toMatchObject({ ok: false });
    expect(validateLabel("x".repeat(61))).toMatchObject({ ok: false });
    expect(validatePrompt("")).toEqual({ ok: true, data: "" });
    expect(validatePrompt("x".repeat(501))).toMatchObject({ ok: false });
  });
});

describe("validateWindow", () => {
  it("accepts end after start, start not in the past", () => {
    expect(validateWindow(later(5), later(65), now)).toEqual({ ok: true, data: { startsAt: later(5), endsAt: later(65) } });
    expect(validateWindow(now, later(1), now).ok).toBe(true);
  });
  it("rejects end <= start", () => {
    expect(validateWindow(later(10), later(10), now)).toMatchObject({ ok: false, error: "INVALID_WINDOW" });
    expect(validateWindow(later(10), later(5), now)).toMatchObject({ ok: false, error: "INVALID_WINDOW" });
  });
  it("rejects a start in the past", () => {
    expect(validateWindow(later(-1), later(60), now)).toMatchObject({ ok: false, error: "INVALID_WINDOW" });
  });
  it("rejects invalid dates", () => {
    expect(validateWindow(new Date("nope"), later(60), now)).toMatchObject({ ok: false, error: "INVALID_WINDOW" });
  });
});

describe("publishPreconditions", () => {
  const game = { publishedAt: null, generatedImageKey: "gen/1.png", startsAt: later(5), endsAt: later(65) };
  const confirmed = { confirmed: true };
  it("passes with 1..5 confirmed objects, an image, and a window", () => {
    expect(publishPreconditions(game, [confirmed])).toEqual({ ok: true, data: null });
    expect(publishPreconditions(game, Array(5).fill(confirmed)).ok).toBe(true);
  });
  it("rejects already published", () => {
    expect(publishPreconditions({ ...game, publishedAt: now }, [confirmed])).toMatchObject({ error: "NOT_DRAFT" });
  });
  it("rejects zero or more than five objects", () => {
    expect(publishPreconditions(game, [])).toMatchObject({ error: "NO_OBJECTS" });
    expect(publishPreconditions(game, Array(6).fill(confirmed))).toMatchObject({ error: "TOO_MANY_OBJECTS" });
  });
  it("rejects a missing image", () => {
    expect(publishPreconditions({ ...game, generatedImageKey: null }, [confirmed])).toMatchObject({ error: "NO_IMAGE" });
  });
  it("rejects any unconfirmed object (invariant 4)", () => {
    expect(publishPreconditions(game, [confirmed, { confirmed: false }])).toMatchObject({ error: "UNCONFIRMED_OBJECTS" });
  });
  it("rejects a missing window", () => {
    expect(publishPreconditions({ ...game, startsAt: null }, [confirmed])).toMatchObject({ error: "INVALID_WINDOW" });
  });
});

describe("validateMarkerCount", () => {
  it("requires exactly N", () => {
    expect(validateMarkerCount(3, 3)).toEqual({ ok: true, data: null });
    expect(validateMarkerCount(2, 3)).toMatchObject({ error: "WRONG_MARKER_COUNT" });
    expect(validateMarkerCount(4, 3)).toMatchObject({ error: "WRONG_MARKER_COUNT" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/games/__tests__/validation.test.ts`
Expected: FAIL — cannot resolve `../validation`.

- [ ] **Step 3: Implement**

`src/lib/games/result.ts`:
```ts
/**
 * Every server action returns one of these. Nothing throws across the action boundary,
 * so the UI can render a specific, actionable message (SPEC §8).
 */
export type ActionError =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "NOT_MASTER"
  | "INVALID_INPUT"
  | "NOT_DRAFT"
  | "NO_OBJECTS"
  | "TOO_MANY_OBJECTS"
  | "NO_IMAGE"
  | "UNCONFIRMED_OBJECTS"
  | "INVALID_WINDOW"
  | "NOT_ACTIVE"
  | "MASTER_CANNOT_PLAY"
  | "NOT_STARTED"
  | "ALREADY_SUBMITTED"
  | "WRONG_MARKER_COUNT"
  | "LEADERBOARD_HIDDEN";

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ActionError; readonly message: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: ActionError, message: string): ActionResult<never> => ({ ok: false, error, message });
```

`src/lib/games/validation.ts`:
```ts
/** Pure input and precondition checks. No I/O. */
import { MAX_OBJECTS_PER_GAME, MIN_OBJECTS_PER_GAME } from "@/lib/types";
import { fail, ok, type ActionResult } from "./result";

const bounded = (value: string, min: number, max: number, what: string): ActionResult<string> => {
  const s = value.trim();
  if (s.length < min || s.length > max) {
    return fail("INVALID_INPUT", `${what} must be ${min}–${max} characters`);
  }
  return ok(s);
};

export const validateTitle = (s: string) => bounded(s, 1, 120, "Title");
export const validateLabel = (s: string) => bounded(s, 1, 60, "Label");
export const validatePrompt = (s: string) => bounded(s, 0, 500, "Prompt");

const isValidDate = (d: Date) => Number.isFinite(d.getTime());

export function validateWindow(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): ActionResult<{ startsAt: Date; endsAt: Date }> {
  if (!isValidDate(startsAt) || !isValidDate(endsAt)) return fail("INVALID_WINDOW", "Start and end must be valid dates");
  if (endsAt.getTime() <= startsAt.getTime()) return fail("INVALID_WINDOW", "End must be after start");
  if (startsAt.getTime() < now.getTime()) return fail("INVALID_WINDOW", "Start cannot be in the past");
  return ok({ startsAt, endsAt });
}

export type PublishGameSource = {
  readonly publishedAt: Date | null;
  readonly generatedImageKey: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
};
export type PublishObjectSource = { readonly confirmed: boolean };

/** Invariant 4 lives here and is re-checked inside the publish transaction. */
export function publishPreconditions(
  game: PublishGameSource,
  objects: readonly PublishObjectSource[],
): ActionResult<null> {
  if (game.publishedAt !== null) return fail("NOT_DRAFT", "Game is already published");
  if (objects.length < MIN_OBJECTS_PER_GAME) return fail("NO_OBJECTS", "Add at least one object");
  if (objects.length > MAX_OBJECTS_PER_GAME) return fail("TOO_MANY_OBJECTS", `At most ${MAX_OBJECTS_PER_GAME} objects`);
  if (game.generatedImageKey === null) return fail("NO_IMAGE", "Generate the image first");
  const unconfirmed = objects.filter((o) => !o.confirmed).length;
  if (unconfirmed > 0) return fail("UNCONFIRMED_OBJECTS", `${unconfirmed} object(s) not confirmed`);
  if (game.startsAt === null || game.endsAt === null) return fail("INVALID_WINDOW", "Set the start and end");
  return ok(null);
}

export function validateMarkerCount(markerCount: number, objectCount: number): ActionResult<null> {
  if (markerCount !== objectCount) {
    return fail("WRONG_MARKER_COUNT", `Place exactly ${objectCount} marker(s); you placed ${markerCount}`);
  }
  return ok(null);
}
```

- [ ] **Step 4: Run tests, verify, commit**

Run: `npx vitest run src/lib/games/__tests__/validation.test.ts` → all pass. Then:
```bash
npm run verify && git add -A && git commit -m "feat(platform): ActionResult and pure validation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Clerk auth — proxy, provider, pages, user mirror

**Files:**
- Create: `src/proxy.ts`, `src/lib/auth.ts`, `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- Modify: `src/app/layout.tsx`, `.env.example`
- Test: `src/lib/__tests__/auth.test.ts` (unit), `src/lib/__tests__/auth.integration.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `Database` (Task 1).
- Produces:
  ```ts
  type ClerkUserLike = { id: string; primaryEmailAddress: { emailAddress: string } | null; fullName: string | null; imageUrl: string };
  toUserRow(u: ClerkUserLike): NewUser | null        // null when no email
  upsertUser(db: Database, row: NewUser): Promise<User>
  getCurrentUser(): Promise<User | null>             // Clerk session → upsert → row
  ```

- [ ] **Step 1: Write the failing unit test**

`src/lib/__tests__/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toUserRow } from "../auth";

describe("toUserRow", () => {
  it("maps id, email, name, image", () => {
    expect(
      toUserRow({ id: "user_1", primaryEmailAddress: { emailAddress: "a@b.co" }, fullName: "Ada", imageUrl: "https://img/a.png" }),
    ).toEqual({ id: "user_1", email: "a@b.co", name: "Ada", imageUrl: "https://img/a.png" });
  });
  it("returns null without an email (cannot satisfy users.email NOT NULL)", () => {
    expect(toUserRow({ id: "user_1", primaryEmailAddress: null, fullName: null, imageUrl: "" })).toBeNull();
  });
  it("stores null name for an empty name", () => {
    expect(toUserRow({ id: "u", primaryEmailAddress: { emailAddress: "a@b.co" }, fullName: "  ", imageUrl: "" })).toMatchObject({ name: null });
  });
});
```

- [ ] **Step 2: Write the failing integration test**

`src/lib/__tests__/auth.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { users } from "@/db/schema";
import { upsertUser } from "../auth";

const { db, close } = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => close());

describe("upsertUser", () => {
  it("inserts on first sign-in and refreshes name/image on later calls", async () => {
    const first = await upsertUser(db, { id: "user_1", email: "a@b.co", name: "Ada", imageUrl: null });
    expect(first.name).toBe("Ada");
    const second = await upsertUser(db, { id: "user_1", email: "a@b.co", name: "Ada L.", imageUrl: "https://img/a.png" });
    expect(second).toMatchObject({ name: "Ada L.", imageUrl: "https://img/a.png" });
    expect(await db.select().from(users)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npx vitest run src/lib/__tests__/auth.test.ts && npm run test:integration`
Expected: FAIL — cannot resolve `../auth`.

- [ ] **Step 4: Implement auth module, proxy, provider, pages**

`src/lib/auth.ts`:
```ts
/**
 * Clerk is the identity provider; `users` is a mirror written lazily on first server
 * action (SPEC §5.2). No webhook: the row is upserted whenever we resolve the session.
 */
import { currentUser } from "@clerk/nextjs/server";
import { getDb, type Database } from "@/db";
import { users, type NewUser, type User } from "@/db/schema";

export type ClerkUserLike = {
  readonly id: string;
  readonly primaryEmailAddress: { readonly emailAddress: string } | null;
  readonly fullName: string | null;
  readonly imageUrl: string;
};

export function toUserRow(u: ClerkUserLike): NewUser | null {
  const email = u.primaryEmailAddress?.emailAddress;
  if (!email) return null;
  const name = u.fullName?.trim() || null;
  return { id: u.id, email, name, imageUrl: u.imageUrl || null };
}

export async function upsertUser(db: Database, row: NewUser): Promise<User> {
  const [user] = await db
    .insert(users)
    .values(row)
    .onConflictDoUpdate({
      target: users.id,
      set: { email: row.email, name: row.name ?? null, imageUrl: row.imageUrl ?? null },
    })
    .returning();
  return user;
}

/** The signed-in user as a `users` row, or null. Call from server actions and pages. */
export async function getCurrentUser(): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;
  const row = toUserRow(clerkUser);
  if (!row) return null;
  return upsertUser(getDb(), row);
}
```

`src/proxy.ts`:
```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Play pages are public: the server decides per game whether to 404 (SPEC §3.3.1).
const isPublic = createRouteMatcher(["/", "/g/(.*)", "/sign-in(.*)", "/sign-up(.*)", "/api/generate/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
```

`src/app/layout.tsx` — wrap the tree:
```tsx
import { ClerkProvider } from "@clerk/nextjs";
// ... existing imports
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

`src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:
```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
```
`src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` — same with `SignUp`.

`.env.example` — under Clerk add:
```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

- [ ] **Step 5: Run tests; smoke the dev server**

Run: `npx vitest run src/lib/__tests__/auth.test.ts && npm run test:integration` → pass.
The user adds `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local` (Clerk app with Google enabled). Then `npm run dev`, open `/sign-in`, sign in with Google, confirm a `users` row appears (`select * from users` via `npx drizzle-kit studio` or a probe).

- [ ] **Step 6: Verify and commit**

```bash
npm run verify && git add -A && git commit -m "feat(platform): Clerk auth with lazy users mirror

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Storage — keys, presigned PUT/GET

**Files:**
- Create: `src/lib/storage.ts`, `src/lib/games/upload.ts`
- Test: `src/lib/__tests__/storage.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  ```ts
  type AssetKind = "background" | "object";
  objectKey(kind: AssetKind, gameId: string, contentType: string): string   // "games/<gameId>/<kind>/<nanoid>.<ext>"
  isAllowedImageType(ct: string): ct is "image/png" | "image/jpeg" | "image/webp"
  presignPut(key: string, contentType: string): Promise<string>            // 5 min
  presignGet(key: string): Promise<string>                                 // 1 h
  resolveUrl(key: string): string   // NOTE: sync wrapper — see Step 3
  requestUploadUrl(input: { gameId: string; kind: AssetKind; contentType: string }): Promise<ActionResult<{ key: string; url: string }>>
  ```

- [ ] **Step 1: Write the failing unit test**

`src/lib/__tests__/storage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isAllowedImageType, objectKey } from "../storage";

describe("objectKey", () => {
  it("namespaces by game and kind and picks the extension from the content type", () => {
    const key = objectKey("background", "11111111-1111-4111-8111-111111111111", "image/png");
    expect(key).toMatch(/^games\/11111111-1111-4111-8111-111111111111\/background\/[A-Za-z0-9_-]{21}\.png$/);
    expect(objectKey("object", "g", "image/jpeg")).toMatch(/\.jpg$/);
    expect(objectKey("object", "g", "image/webp")).toMatch(/\.webp$/);
  });
  it("throws on a disallowed content type", () => {
    expect(() => objectKey("object", "g", "image/gif")).toThrow();
  });
});

describe("isAllowedImageType", () => {
  it("allows png, jpeg, webp only", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/gif")).toBe(false);
    expect(isAllowedImageType("text/html")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/storage.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

`src/lib/storage.ts`:
```ts
/**
 * Neon Object Storage (S3-compatible). The app stores keys; browsers get presigned URLs.
 * Uploads go browser → presigned PUT so image bytes never pass through a function.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

export const BUCKET = "assets"; // declared in neon.ts, private

const ALLOWED = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type AllowedImageType = keyof typeof ALLOWED;
export type AssetKind = "background" | "object";

export function isAllowedImageType(ct: string): ct is AllowedImageType {
  return ct in ALLOWED;
}

export function objectKey(kind: AssetKind, gameId: string, contentType: string): string {
  if (!isAllowedImageType(contentType)) throw new Error(`Disallowed content type ${contentType}`);
  return `games/${gameId}/${kind}/${nanoid()}.${ALLOWED[contentType]}`;
}

let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
  });
  return client;
}

export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: 300,
  });
}

export function presignGet(key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
}
```

**`resolveUrl` is synchronous in `projectGame`'s signature, but presigning is async.** Resolve this without touching the frozen contract: pre-sign every key the view will need, then hand `projectGame` a lookup. Add to `src/lib/storage.ts`:
```ts
/** Presign a set of keys up front so a synchronous `resolveUrl` can be given to `projectGame`. */
export async function urlResolverFor(keys: readonly (string | null)[]): Promise<(key: string) => string> {
  const unique = [...new Set(keys.filter((k): k is string => k !== null))];
  const urls = await Promise.all(unique.map(presignGet));
  const map = new Map(unique.map((k, i) => [k, urls[i]]));
  return (key) => {
    const url = map.get(key);
    if (!url) throw new Error(`No presigned URL for key ${key}`);
    return url;
  };
}
```

`src/lib/games/upload.ts`:
```ts
"use server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/db";
import { games } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isAllowedImageType, objectKey, presignPut, type AssetKind } from "@/lib/storage";
import { fail, ok, type ActionResult } from "./result";

export async function requestUploadUrl(input: {
  gameId: string;
  kind: AssetKind;
  contentType: string;
}): Promise<ActionResult<{ key: string; url: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  if (!isAllowedImageType(input.contentType)) return fail("INVALID_INPUT", "Use a PNG, JPEG, or WebP image");
  const [game] = await getDb().select({ masterId: games.masterId, publishedAt: games.publishedAt }).from(games).where(eq(games.id, input.gameId));
  if (!game) return fail("NOT_FOUND", "Game not found");
  if (game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can upload");
  if (game.publishedAt !== null) return fail("NOT_DRAFT", "Published games cannot change images");
  const key = objectKey(input.kind, input.gameId, input.contentType);
  return ok({ key, url: await presignPut(key, input.contentType) });
}
```

`.env.example` — add under app: `NEXT_PUBLIC_APP_URL=http://localhost:3000` with a comment that the bucket CORS must allow this origin.

- [ ] **Step 4: Set bucket CORS to the app origins**

One-off, run by the user or via a probe script in the scratchpad (not committed): CORS rules `AllowedOrigins: ["http://localhost:3000", "<vercel-url>"]`, `AllowedMethods: ["PUT","GET"]`, `AllowedHeaders: ["*"]`, `ExposeHeaders: ["ETag"]`. The bucket currently allows `*`, which works for development; tighten before deploy.

- [ ] **Step 5: Run tests, verify, commit**

```bash
npx vitest run src/lib/__tests__/storage.test.ts && npm run verify && git add -A && git commit -m "feat(platform): object storage keys and presigned upload

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Game authoring core

**Files:**
- Create: `src/lib/games/games.ts`
- Test: `src/lib/games/__tests__/games.integration.test.ts`

**Interfaces:**
- Consumes: `Database`, `User`, validation (Task 2), `nanoid`.
- Produces (all `(db: Database, user: User, …) => Promise<ActionResult<…>>`):
  ```ts
  createGame(db, user, { title, generalPrompt }) → { id: string; publicId: string }
  updateGame(db, user, gameId, { title?, generalPrompt?, backgroundKey? }) → null
  deleteGame(db, user, gameId) → null                                  // draft only
  addObject(db, user, gameId, { label, prompt, sourceImageKey, requestedScale? }) → { id: string }
  updateObject(db, user, objectId, { label?, prompt?, sourceImageKey?, requestedScale?, x?, y?, radius? }) → null
      // any of x/y/radius present ⇒ all three required, and confirmed := false
  removeObject(db, user, objectId) → null
  confirmObject(db, user, objectId) → null                             // requires a position
  setWindow(db, user, gameId, { startsAt: Date; endsAt: Date }, now: Date) → null
  publishGame(db, user, gameId, now: Date) → { publishedAt: Date }     // transaction, FOR UPDATE
  unpublishGame(db, user, gameId, now: Date) → null                    // only while scheduled
  ```
  Internal helper: `loadOwnedGame(tx, user, gameId) → ActionResult<Game>` returning `NOT_FOUND` / `NOT_MASTER`.

- [ ] **Step 1: Write the failing integration test**

`src/lib/games/__tests__/games.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test";
import { games, objects, users, type User } from "@/db/schema";
import { normalized } from "@/lib/types";
import {
  addObject, confirmObject, createGame, deleteGame, publishGame, removeObject,
  setWindow, unpublishGame, updateGame, updateObject,
} from "../games";

const { db, close } = createTestDb();
const now = new Date("2026-09-13T10:00:00Z");
const later = (min: number) => new Date(now.getTime() + min * 60_000);
let master: User;
let other: User;

beforeEach(async () => {
  await truncateAll(db);
  [master, other] = await db
    .insert(users)
    .values([{ id: "u_master", email: "m@x.co" }, { id: "u_other", email: "o@x.co" }])
    .returning();
});
afterAll(() => close());

async function draftWithConfirmedObject() {
  const g = await createGame(db, master, { title: "Kitchen", generalPrompt: "" });
  if (!g.ok) throw new Error(g.message);
  await updateGame(db, master, g.data.id, { backgroundKey: "games/x/background/a.png" });
  await db.update(games).set({ generatedImageKey: "games/x/gen/1.png", imageWidth: 1000, imageHeight: 800 }).where(eq(games.id, g.data.id));
  const o = await addObject(db, master, g.data.id, { label: "mug", prompt: "", sourceImageKey: "games/x/object/m.png" });
  if (!o.ok) throw new Error(o.message);
  await updateObject(db, master, o.data.id, { x: normalized(0.5), y: normalized(0.5), radius: normalized(0.05) });
  await confirmObject(db, master, o.data.id);
  await setWindow(db, master, g.data.id, { startsAt: later(5), endsAt: later(65) }, now);
  return { gameId: g.data.id, objectId: o.data.id };
}

describe("createGame", () => {
  it("creates a draft with a 21-char publicId owned by the caller", async () => {
    const r = await createGame(db, master, { title: "  Kitchen ", generalPrompt: "moody" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.publicId).toHaveLength(21);
    const [row] = await db.select().from(games).where(eq(games.id, r.data.id));
    expect(row).toMatchObject({ title: "Kitchen", masterId: master.id, publishedAt: null });
  });
  it("rejects an empty title", async () => {
    expect(await createGame(db, master, { title: " ", generalPrompt: "" })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("ownership", () => {
  it("a non-master gets NOT_MASTER, a missing game NOT_FOUND", async () => {
    const { gameId } = await draftWithConfirmedObject();
    expect(await updateGame(db, other, gameId, { title: "x" })).toMatchObject({ error: "NOT_MASTER" });
    expect(await updateGame(db, master, "00000000-0000-4000-8000-000000000000", { title: "x" })).toMatchObject({ error: "NOT_FOUND" });
  });
});

describe("objects", () => {
  it("caps at five objects and assigns sortOrder sequentially", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    for (let i = 0; i < 5; i++) {
      expect((await addObject(db, master, g.data.id, { label: `o${i}`, prompt: "", sourceImageKey: `k${i}` })).ok).toBe(true);
    }
    expect(await addObject(db, master, g.data.id, { label: "six", prompt: "", sourceImageKey: "k6" })).toMatchObject({ error: "TOO_MANY_OBJECTS" });
    const rows = await db.select({ sortOrder: objects.sortOrder }).from(objects).where(eq(objects.gameId, g.data.id)).orderBy(objects.sortOrder);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("a position write resets confirmed (handoff rule)", async () => {
    const { objectId } = await draftWithConfirmedObject();
    let [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row.confirmed).toBe(true);
    await updateObject(db, master, objectId, { x: normalized(0.6), y: normalized(0.5), radius: normalized(0.05) });
    [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row).toMatchObject({ confirmed: false, x: 0.6 });
  });

  it("a label-only write keeps confirmed", async () => {
    const { objectId } = await draftWithConfirmedObject();
    await updateObject(db, master, objectId, { label: "cup" });
    const [row] = await db.select().from(objects).where(eq(objects.id, objectId));
    expect(row).toMatchObject({ confirmed: true, label: "cup" });
  });

  it("confirm requires a position", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    const o = await addObject(db, master, g.data.id, { label: "o", prompt: "", sourceImageKey: "k" });
    if (!o.ok) throw new Error();
    expect(await confirmObject(db, master, o.data.id)).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("removeObject deletes and compacts sortOrder", async () => {
    const g = await createGame(db, master, { title: "t", generalPrompt: "" });
    if (!g.ok) throw new Error();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await addObject(db, master, g.data.id, { label: `o${i}`, prompt: "", sourceImageKey: `k${i}` });
      if (!o.ok) throw new Error();
      ids.push(o.data.id);
    }
    await removeObject(db, master, ids[1]);
    const rows = await db.select({ id: objects.id, sortOrder: objects.sortOrder }).from(objects).where(eq(objects.gameId, g.data.id)).orderBy(objects.sortOrder);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
    expect(rows.map((r) => r.id)).toEqual([ids[0], ids[2]]);
  });
});

describe("publishGame", () => {
  it("publishes a fully confirmed draft", async () => {
    const { gameId } = await draftWithConfirmedObject();
    const r = await publishGame(db, master, gameId, now);
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(games).where(eq(games.id, gameId));
    expect(row.publishedAt).not.toBeNull();
  });

  it("rejects with UNCONFIRMED_OBJECTS and writes nothing (invariant 4)", async () => {
    const { gameId, objectId } = await draftWithConfirmedObject();
    await updateObject(db, master, objectId, { x: normalized(0.4), y: normalized(0.4), radius: normalized(0.05) });
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ ok: false, error: "UNCONFIRMED_OBJECTS" });
    const [row] = await db.select().from(games).where(eq(games.id, gameId));
    expect(row.publishedAt).toBeNull();
  });

  it("rejects without an image, without objects, and when already published", async () => {
    const { gameId } = await draftWithConfirmedObject();
    await db.update(games).set({ generatedImageKey: null, imageWidth: null, imageHeight: null }).where(eq(games.id, gameId));
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ error: "NO_IMAGE" });
    await db.update(games).set({ generatedImageKey: "k", imageWidth: 1, imageHeight: 1 }).where(eq(games.id, gameId));
    expect((await publishGame(db, master, gameId, now)).ok).toBe(true);
    expect(await publishGame(db, master, gameId, now)).toMatchObject({ error: "NOT_DRAFT" });
  });

  it("rejects a window whose start is already past at publish time", async () => {
    const { gameId } = await draftWithConfirmedObject();
    expect(await publishGame(db, master, gameId, later(10))).toMatchObject({ error: "INVALID_WINDOW" });
  });
});

describe("after publish", () => {
  it("draft-only mutations are refused; unpublish works only while scheduled", async () => {
    const { gameId, objectId } = await draftWithConfirmedObject();
    await publishGame(db, master, gameId, now);
    expect(await updateObject(db, master, objectId, { label: "x" })).toMatchObject({ error: "NOT_DRAFT" });
    expect(await addObject(db, master, gameId, { label: "x", prompt: "", sourceImageKey: "k" })).toMatchObject({ error: "NOT_DRAFT" });
    expect(await deleteGame(db, master, gameId)).toMatchObject({ error: "NOT_DRAFT" });
    expect((await unpublishGame(db, master, gameId, later(1))).ok).toBe(true);       // still scheduled
    await publishGame(db, master, gameId, now);
    expect(await unpublishGame(db, master, gameId, later(10))).toMatchObject({ error: "NOT_DRAFT" }); // active now
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration` → FAIL, `../games` missing.

- [ ] **Step 3: Implement**

`src/lib/games/games.ts`:
```ts
/**
 * Authoring core. Every function takes the database and the acting user explicitly so
 * integration tests run the real logic; `actions.ts` wraps these for the UI.
 */
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Database } from "@/db";
import { games, objects, type Game, type User } from "@/db/schema";
import { deriveStatus } from "@/lib/status";
import { MAX_OBJECTS_PER_GAME, PUBLIC_ID_LENGTH, type Normalized } from "@/lib/types";
import { fail, ok, type ActionResult } from "./result";
import { publishPreconditions, validateLabel, validatePrompt, validateTitle, validateWindow } from "./validation";

// Drizzle's transaction handle has the same query surface as the root db.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

async function loadOwnedGame(db: Db, user: User, gameId: string, forUpdate = false): Promise<ActionResult<Game>> {
  const q = db.select().from(games).where(eq(games.id, gameId));
  const [game] = forUpdate ? await q.for("update") : await q;
  if (!game) return fail("NOT_FOUND", "Game not found");
  if (game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can do that");
  return ok(game);
}

const requireDraft = (game: Game): ActionResult<Game> =>
  game.publishedAt === null ? ok(game) : fail("NOT_DRAFT", "Unpublish the game to edit it");

export async function createGame(
  db: Database,
  user: User,
  input: { title: string; generalPrompt: string },
): Promise<ActionResult<{ id: string; publicId: string }>> {
  const title = validateTitle(input.title);
  if (!title.ok) return title;
  const prompt = validatePrompt(input.generalPrompt);
  if (!prompt.ok) return prompt;
  const publicId = nanoid(PUBLIC_ID_LENGTH);
  const [row] = await db
    .insert(games)
    .values({ publicId, masterId: user.id, title: title.data, generalPrompt: prompt.data })
    .returning({ id: games.id, publicId: games.publicId });
  return ok(row);
}

export async function updateGame(
  db: Database,
  user: User,
  gameId: string,
  input: { title?: string; generalPrompt?: string; backgroundKey?: string },
): Promise<ActionResult<null>> {
  const owned = await loadOwnedGame(db, user, gameId);
  if (!owned.ok) return owned;
  const draft = requireDraft(owned.data);
  if (!draft.ok) return draft;
  const set: Partial<typeof games.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    const t = validateTitle(input.title);
    if (!t.ok) return t;
    set.title = t.data;
  }
  if (input.generalPrompt !== undefined) {
    const p = validatePrompt(input.generalPrompt);
    if (!p.ok) return p;
    set.generalPrompt = p.data;
  }
  if (input.backgroundKey !== undefined) set.backgroundKey = input.backgroundKey;
  await db.update(games).set(set).where(eq(games.id, gameId));
  return ok(null);
}

export async function deleteGame(db: Database, user: User, gameId: string): Promise<ActionResult<null>> {
  const owned = await loadOwnedGame(db, user, gameId);
  if (!owned.ok) return owned;
  const draft = requireDraft(owned.data);
  if (!draft.ok) return draft;
  await db.delete(games).where(eq(games.id, gameId)); // objects cascade
  return ok(null);
}

export async function addObject(
  db: Database,
  user: User,
  gameId: string,
  input: { label: string; prompt: string; sourceImageKey: string; requestedScale?: Normalized },
): Promise<ActionResult<{ id: string }>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedGame(tx, user, gameId, true);
    if (!owned.ok) return owned;
    const draft = requireDraft(owned.data);
    if (!draft.ok) return draft;
    const label = validateLabel(input.label);
    if (!label.ok) return label;
    const prompt = validatePrompt(input.prompt);
    if (!prompt.ok) return prompt;
    const [{ n }] = await tx.select({ n: count() }).from(objects).where(eq(objects.gameId, gameId));
    if (n >= MAX_OBJECTS_PER_GAME) return fail("TOO_MANY_OBJECTS", `At most ${MAX_OBJECTS_PER_GAME} objects`);
    const [row] = await tx
      .insert(objects)
      .values({
        gameId,
        label: label.data,
        prompt: prompt.data,
        sourceImageKey: input.sourceImageKey,
        requestedScale: input.requestedScale ?? null,
        sortOrder: n,
      })
      .returning({ id: objects.id });
    return ok(row);
  });
}

async function loadOwnedObject(db: Db, user: User, objectId: string): Promise<ActionResult<{ object: typeof objects.$inferSelect; game: Game }>> {
  const [row] = await db
    .select({ object: objects, game: games })
    .from(objects)
    .innerJoin(games, eq(games.id, objects.gameId))
    .where(eq(objects.id, objectId));
  if (!row) return fail("NOT_FOUND", "Object not found");
  if (row.game.masterId !== user.id) return fail("NOT_MASTER", "Only the game master can do that");
  const draft = requireDraft(row.game);
  if (!draft.ok) return draft;
  return ok(row);
}

export async function updateObject(
  db: Database,
  user: User,
  objectId: string,
  input: {
    label?: string;
    prompt?: string;
    sourceImageKey?: string;
    requestedScale?: Normalized | null;
    x?: Normalized;
    y?: Normalized;
    radius?: Normalized;
  },
): Promise<ActionResult<null>> {
  const owned = await loadOwnedObject(db, user, objectId);
  if (!owned.ok) return owned;
  const set: Partial<typeof objects.$inferInsert> = {};
  if (input.label !== undefined) {
    const l = validateLabel(input.label);
    if (!l.ok) return l;
    set.label = l.data;
  }
  if (input.prompt !== undefined) {
    const p = validatePrompt(input.prompt);
    if (!p.ok) return p;
    set.prompt = p.data;
  }
  if (input.sourceImageKey !== undefined) set.sourceImageKey = input.sourceImageKey;
  if (input.requestedScale !== undefined) set.requestedScale = input.requestedScale;
  const positional = [input.x, input.y, input.radius];
  if (positional.some((v) => v !== undefined)) {
    if (positional.some((v) => v === undefined)) return fail("INVALID_INPUT", "x, y and radius must be set together");
    // Handoff rule: a new position invalidates any previous confirmation.
    Object.assign(set, { x: input.x, y: input.y, radius: input.radius, confirmed: false });
  }
  if (Object.keys(set).length === 0) return ok(null);
  await db.update(objects).set(set).where(eq(objects.id, objectId));
  return ok(null);
}

export async function confirmObject(db: Database, user: User, objectId: string): Promise<ActionResult<null>> {
  const owned = await loadOwnedObject(db, user, objectId);
  if (!owned.ok) return owned;
  if (owned.data.object.x === null) return fail("INVALID_INPUT", "The object has no position to confirm");
  await db.update(objects).set({ confirmed: true }).where(eq(objects.id, objectId));
  return ok(null);
}

export async function removeObject(db: Database, user: User, objectId: string): Promise<ActionResult<null>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedObject(tx, user, objectId);
    if (!owned.ok) return owned;
    const { object } = owned.data;
    await tx.delete(objects).where(eq(objects.id, objectId));
    await tx
      .update(objects)
      .set({ sortOrder: sql`${objects.sortOrder} - 1` })
      .where(and(eq(objects.gameId, object.gameId), gt(objects.sortOrder, object.sortOrder)));
    return ok(null);
  });
}

export async function setWindow(
  db: Database,
  user: User,
  gameId: string,
  input: { startsAt: Date; endsAt: Date },
  now: Date,
): Promise<ActionResult<null>> {
  const owned = await loadOwnedGame(db, user, gameId);
  if (!owned.ok) return owned;
  const draft = requireDraft(owned.data);
  if (!draft.ok) return draft;
  const w = validateWindow(input.startsAt, input.endsAt, now);
  if (!w.ok) return w;
  await db.update(games).set({ startsAt: w.data.startsAt, endsAt: w.data.endsAt, updatedAt: now }).where(eq(games.id, gameId));
  return ok(null);
}

/** Invariant 4: the check and the write happen in one transaction with the game row locked. */
export async function publishGame(
  db: Database,
  user: User,
  gameId: string,
  now: Date,
): Promise<ActionResult<{ publishedAt: Date }>> {
  return db.transaction(async (tx) => {
    const owned = await loadOwnedGame(tx, user, gameId, true);
    if (!owned.ok) return owned;
    const game = owned.data;
    const objs = await tx.select({ confirmed: objects.confirmed }).from(objects).where(eq(objects.gameId, gameId)).orderBy(asc(objects.sortOrder));
    const pre = publishPreconditions(game, objs);
    if (!pre.ok) return pre;
    // publishPreconditions guarantees both are non-null.
    const w = validateWindow(game.startsAt as Date, game.endsAt as Date, now);
    if (!w.ok) return w;
    await tx.update(games).set({ publishedAt: now, updatedAt: now }).where(eq(games.id, gameId));
    return ok({ publishedAt: now });
  });
}

/** Allowed only while `scheduled`; an active or finished game is immutable (SPEC §10). */
export async function unpublishGame(db: Database, user: User, gameId: string, now: Date): Promise<ActionResult<null>> {
  const owned = await loadOwnedGame(db, user, gameId);
  if (!owned.ok) return owned;
  if (deriveStatus(owned.data, now) !== "scheduled") return fail("NOT_DRAFT", "Only a scheduled game can be unpublished");
  await db.update(games).set({ publishedAt: null, updatedAt: now }).where(eq(games.id, gameId));
  return ok(null);
}
```

- [ ] **Step 4: Run, verify, commit**

Run: `npm run test:integration` → all pass. Type errors on `.for("update")` or `count()` — check drizzle 0.45 docs in `node_modules/drizzle-orm` and adjust (e.g. `sql<number>\`count(*)\``), keep behaviour identical.
```bash
npm run verify && git add -A && git commit -m "feat(platform): game authoring core with transactional publish

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Queries — the projected read path

**Files:**
- Create: `src/lib/games/queries.ts`
- Test: `src/lib/games/__tests__/queries.integration.test.ts`

**Interfaces:**
- Consumes: `projectGame`, `urlResolverFor` (Task 4), `Database`.
- Produces:
  ```ts
  loadGameForViewer(db, publicId: string, userId: string | null, now: Date): Promise<GameView | null>
  loadGameForMasterById(db, gameId: string, userId: string, now: Date): Promise<MasterGameView | null>
  listGamesForMaster(db, userId: string, now: Date): Promise<Array<{ id; publicId; title; status: GameStatus; startsAt; endsAt }>>
  ```
  `urlResolverFor` is injectable via an optional last param `resolve?: (keys) => Promise<(k) => string>` so tests use identity.

- [ ] **Step 1: Write the failing integration test**

`src/lib/games/__tests__/queries.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test";
import { games, generationRuns, objects, users } from "@/db/schema";
import { normalized } from "@/lib/types";
import { listGamesForMaster, loadGameForViewer } from "../queries";

const { db, close } = createTestDb();
const identityResolver = async () => (k: string) => `url:${k}`;
const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
let gameId: string;

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(users).values([{ id: "u_master", email: "m@x.co" }, { id: "u_player", email: "p@x.co" }]);
  [{ id: gameId }] = await db.insert(games).values({
    publicId: "abcdefghijklmnopqrstu", masterId: "u_master", title: "K",
    generatedImageKey: "gen/k.png", imageWidth: 1000, imageHeight: 800,
    startsAt, endsAt, publishedAt: ms(startsAt, -86_400_000),
  }).returning({ id: games.id });
  await db.insert(objects).values({ gameId, label: "mug", sourceImageKey: "obj/m.png", sortOrder: 0, x: normalized(0.5), y: normalized(0.5), radius: normalized(0.05), confirmed: true });
  await db.insert(generationRuns).values({ gameId, attemptNumber: 1, status: "passed", promptUsed: "p" });
});
afterAll(() => close());

describe("loadGameForViewer", () => {
  it("returns null for a player before starts_at, a view at starts_at", async () => {
    expect(await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_player", ms(startsAt, -1), identityResolver)).toBeNull();
    const v = await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_player", startsAt, identityResolver);
    expect(v?.status).toBe("active");
    expect(JSON.stringify(v)).not.toMatch(/"x"|"radius"/);
    expect(v?.viewer === "player" && v.image.url).toBe("url:gen/k.png");
  });
  it("returns the master view with runs at any time", async () => {
    const v = await loadGameForViewer(db, "abcdefghijklmnopqrstu", "u_master", ms(startsAt, -1), identityResolver);
    expect(v?.viewer).toBe("master");
    if (v?.viewer !== "master") return;
    expect(v.generationRuns).toHaveLength(1);
    expect(v.objects[0]).toMatchObject({ x: 0.5, confirmed: true });
  });
  it("returns null for an unknown publicId", async () => {
    expect(await loadGameForViewer(db, "zzzzzzzzzzzzzzzzzzzzz", "u_master", startsAt, identityResolver)).toBeNull();
  });
});

describe("listGamesForMaster", () => {
  it("lists only the caller's games with derived status", async () => {
    const list = await listGamesForMaster(db, "u_master", ms(endsAt, 1));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: gameId, status: "finished" });
    expect(await listGamesForMaster(db, "u_player", startsAt)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:integration` → FAIL, module missing.

- [ ] **Step 3: Implement**

`src/lib/games/queries.ts`:
```ts
/**
 * The only read path for game data. Everything returned here has been through
 * `projectGame` (invariant 1). Callers never see rows.
 */
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { games, generationRuns, objects } from "@/db/schema";
import { deriveStatus } from "@/lib/status";
import { urlResolverFor } from "@/lib/storage";
import type { GameStatus, GameView, MasterGameView } from "@/lib/types";
import { projectGame } from "@/lib/visibility";

type Resolver = (keys: readonly (string | null)[]) => Promise<(key: string) => string>;

async function project(
  db: Database,
  game: typeof games.$inferSelect,
  userId: string | null,
  now: Date,
  resolve: Resolver,
): Promise<GameView | null> {
  const objs = await db.select().from(objects).where(eq(objects.gameId, game.id)).orderBy(asc(objects.sortOrder));
  const isMaster = userId !== null && userId === game.masterId;
  const runs = isMaster
    ? await db.select().from(generationRuns).where(eq(generationRuns.gameId, game.id)).orderBy(asc(generationRuns.attemptNumber))
    : [];
  const resolveUrl = await resolve([game.generatedImageKey, game.backgroundKey, ...objs.map((o) => o.sourceImageKey)]);
  return projectGame({ game, objects: objs, generationRuns: runs, userId, now, resolveUrl });
}

export async function loadGameForViewer(
  db: Database,
  publicId: string,
  userId: string | null,
  now: Date,
  resolve: Resolver = urlResolverFor,
): Promise<GameView | null> {
  const [game] = await db.select().from(games).where(eq(games.publicId, publicId));
  if (!game) return null;
  return project(db, game, userId, now, resolve);
}

export async function loadGameForMasterById(
  db: Database,
  gameId: string,
  userId: string,
  now: Date,
  resolve: Resolver = urlResolverFor,
): Promise<MasterGameView | null> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.masterId !== userId) return null;
  const view = await project(db, game, userId, now, resolve);
  return view?.viewer === "master" ? view : null;
}

export async function listGamesForMaster(db: Database, userId: string, now: Date) {
  const rows = await db
    .select({ id: games.id, publicId: games.publicId, title: games.title, startsAt: games.startsAt, endsAt: games.endsAt, publishedAt: games.publishedAt })
    .from(games)
    .where(eq(games.masterId, userId))
    .orderBy(desc(games.createdAt));
  return rows.map(({ publishedAt, ...r }) => ({ ...r, status: deriveStatus({ ...r, publishedAt }, now) as GameStatus }));
}
```

- [ ] **Step 4: Run, verify, commit**

```bash
npm run test:integration && npm run verify && git add -A && git commit -m "feat(platform): projected read queries

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Play core — start, submit, state, leaderboard

**Files:**
- Create: `src/lib/games/play.ts`
- Test: `src/lib/games/__tests__/play.integration.test.ts`

**Interfaces:**
- Consumes: `scoreAttempt`, `validateMarkerCount`, `deriveStatus`, `Database`.
- Produces:
  ```ts
  startAttempt(db, user, publicId, now) → ActionResult<{ startedAt: Date }>       // idempotent
  submitAttempt(db, user, publicId, markers: NormalizedPoint[], now) → ActionResult<AttemptResult>
  getPlayerState(db, user, publicId, now) → ActionResult<PlayerAttemptState>
  getLeaderboard(db, viewer: User | null, publicId, now) → ActionResult<LeaderboardEntry[]>
      // LEADERBOARD_HIDDEN unless viewer has submitted, viewer is master, or game finished
  ```

- [ ] **Step 1: Write the failing integration test**

`src/lib/games/__tests__/play.integration.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test";
import { attempts, games, markers, objects, users, type User } from "@/db/schema";
import { normalized, type NormalizedPoint } from "@/lib/types";
import { getLeaderboard, getPlayerState, startAttempt, submitAttempt } from "../play";

const { db, close } = createTestDb();
const PUB = "abcdefghijklmnopqrstu";
const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
const pt = (x: number, y: number): NormalizedPoint => ({ x: normalized(x), y: normalized(y) });
let master: User, p1: User, p2: User;
let gameId: string;

beforeEach(async () => {
  await truncateAll(db);
  [master, p1, p2] = await db.insert(users).values([
    { id: "u_master", email: "m@x.co", name: "M" }, { id: "u_p1", email: "1@x.co", name: "One" }, { id: "u_p2", email: "2@x.co", name: "Two" },
  ]).returning();
  [{ id: gameId }] = await db.insert(games).values({
    publicId: PUB, masterId: master.id, title: "K", generatedImageKey: "g", imageWidth: 1000, imageHeight: 1000,
    startsAt, endsAt, publishedAt: ms(startsAt, -1000),
  }).returning({ id: games.id });
  await db.insert(objects).values([
    { gameId, label: "a", sourceImageKey: "a", sortOrder: 0, x: normalized(0.2), y: normalized(0.2), radius: normalized(0.05), confirmed: true },
    { gameId, label: "b", sourceImageKey: "b", sortOrder: 1, x: normalized(0.8), y: normalized(0.8), radius: normalized(0.05), confirmed: true },
  ]);
});
afterAll(() => close());

describe("startAttempt", () => {
  it("creates one attempt and returns the same startedAt on repeat (server-anchored)", async () => {
    const a = await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const b = await startAttempt(db, p1, PUB, ms(startsAt, 9000));
    expect(a.ok && b.ok && a.data.startedAt.getTime()).toBe(ms(startsAt, 1000).getTime());
    expect(b.ok && b.data.startedAt.getTime()).toBe(ms(startsAt, 1000).getTime());
    expect(await db.select().from(attempts)).toHaveLength(1);
  });
  it("refuses outside the active window, and refuses the master", async () => {
    expect(await startAttempt(db, p1, PUB, ms(startsAt, -1))).toMatchObject({ error: "NOT_ACTIVE" });
    expect(await startAttempt(db, p1, PUB, endsAt)).toMatchObject({ error: "NOT_ACTIVE" });
    expect(await startAttempt(db, master, PUB, ms(startsAt, 1))).toMatchObject({ error: "MASTER_CANNOT_PLAY" });
  });
});

describe("submitAttempt", () => {
  it("scores server-side, stores markers with assignments, returns count and time only", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const r = await submitAttempt(db, p1, PUB, [pt(0.21, 0.2), pt(0.5, 0.5)], ms(startsAt, 4000));
    expect(r).toEqual({ ok: true, data: { foundCount: 1, elapsedMs: 3000 } });
    const rows = await db.select().from(markers);
    expect(rows.map((m) => m.matchedObjectId !== null)).toEqual([true, false]);
  });
  it("rejects a second submission with ALREADY_SUBMITTED and keeps the first score", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    await submitAttempt(db, p1, PUB, [pt(0.21, 0.2), pt(0.5, 0.5)], ms(startsAt, 4000));
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 5000))).toMatchObject({ error: "ALREADY_SUBMITTED" });
    const [a] = await db.select().from(attempts).where(eq(attempts.userId, p1.id));
    expect(a.foundCount).toBe(1);
    expect(await db.select().from(markers)).toHaveLength(2);
  });
  it("requires exactly N markers and a started attempt", async () => {
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2)], ms(startsAt, 4000))).toMatchObject({ error: "NOT_STARTED" });
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    expect(await submitAttempt(db, p1, PUB, [pt(0.2, 0.2)], ms(startsAt, 4000))).toMatchObject({ error: "WRONG_MARKER_COUNT" });
  });
  it("ignores any client-supplied time: elapsed comes from the DB", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    const r = await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 61_000));
    expect(r.ok && r.data.elapsedMs).toBe(60_000);
  });
});

describe("getPlayerState", () => {
  it("walks not_started → in_progress → submitted", async () => {
    expect(await getPlayerState(db, p1, PUB, ms(startsAt, 1))).toEqual({ ok: true, data: { kind: "not_started" } });
    await startAttempt(db, p1, PUB, ms(startsAt, 1000));
    expect(await getPlayerState(db, p1, PUB, ms(startsAt, 2000))).toMatchObject({ ok: true, data: { kind: "in_progress" } });
    await submitAttempt(db, p1, PUB, [pt(0.2, 0.2), pt(0.8, 0.8)], ms(startsAt, 4000));
    expect(await getPlayerState(db, p1, PUB, ms(startsAt, 5000))).toEqual({ ok: true, data: { kind: "submitted", result: { foundCount: 2, elapsedMs: 3000 } } });
  });
});

describe("getLeaderboard", () => {
  async function play(u: User, pts: NormalizedPoint[], start: number, end: number) {
    await startAttempt(db, u, PUB, ms(startsAt, start));
    await submitAttempt(db, u, PUB, pts, ms(startsAt, end));
  }
  it("is hidden before the viewer submits and visible after; master always sees it", async () => {
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 1000, 9000);
    expect(await getLeaderboard(db, p1, PUB, ms(startsAt, 10_000))).toMatchObject({ error: "LEADERBOARD_HIDDEN" });
    expect(await getLeaderboard(db, null, PUB, ms(startsAt, 10_000))).toMatchObject({ error: "LEADERBOARD_HIDDEN" });
    expect((await getLeaderboard(db, master, PUB, ms(startsAt, 10_000))).ok).toBe(true);
    await play(p1, [pt(0.2, 0.2), pt(0.5, 0.5)], 2000, 4000);
    const r = await getLeaderboard(db, p1, PUB, ms(startsAt, 10_000));
    expect(r.ok && r.data).toEqual([
      { rank: 1, userName: "Two", foundCount: 2, elapsedMs: 8000, isViewer: false },
      { rank: 2, userName: "One", foundCount: 1, elapsedMs: 2000, isViewer: true },
    ]);
  });
  it("is visible to everyone once finished; unsubmitted attempts never appear", async () => {
    await startAttempt(db, p1, PUB, ms(startsAt, 1000)); // abandoned
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 1000, 9000);
    const r = await getLeaderboard(db, null, PUB, endsAt);
    expect(r.ok && r.data.map((e) => e.userName)).toEqual(["Two"]);
  });
  it("ranks by found desc then elapsed asc", async () => {
    await play(p1, [pt(0.2, 0.2), pt(0.8, 0.8)], 0, 20_000);
    await play(p2, [pt(0.2, 0.2), pt(0.8, 0.8)], 0, 10_000);
    const r = await getLeaderboard(db, master, PUB, ms(startsAt, 30_000));
    expect(r.ok && r.data.map((e) => e.userName)).toEqual(["Two", "One"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:integration` → FAIL, `../play` missing.

- [ ] **Step 3: Implement**

`src/lib/games/play.ts`:
```ts
/**
 * Play core. Scoring happens here and only here (invariant 1); timestamps are the
 * server's (invariant 5); a second submit is rejected by a conditional UPDATE.
 */
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "@/db";
import { attempts, games, markers, objects, users, type Game, type User } from "@/db/schema";
import { scoreAttempt } from "@/lib/scoring";
import { deriveStatus } from "@/lib/status";
import type { AttemptResult, LeaderboardEntry, NormalizedPoint, PlayerAttemptState } from "@/lib/types";
import { fail, ok, type ActionResult } from "./result";
import { validateMarkerCount } from "./validation";

async function loadByPublicId(db: Database, publicId: string): Promise<ActionResult<Game>> {
  const [game] = await db.select().from(games).where(eq(games.publicId, publicId));
  return game ? ok(game) : fail("NOT_FOUND", "Game not found");
}

function requirePlayable(game: Game, user: User, now: Date): ActionResult<Game> {
  if (game.masterId === user.id) return fail("MASTER_CANNOT_PLAY", "The game master cannot play their own game");
  if (deriveStatus(game, now) !== "active") return fail("NOT_ACTIVE", "This game is not open for play");
  return ok(game);
}

export async function startAttempt(db: Database, user: User, publicId: string, now: Date): Promise<ActionResult<{ startedAt: Date }>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const playable = requirePlayable(loaded.data, user, now);
  if (!playable.ok) return playable;
  const game = playable.data;
  const inserted = await db
    .insert(attempts)
    .values({ gameId: game.id, userId: user.id, startedAt: now })
    .onConflictDoNothing({ target: [attempts.gameId, attempts.userId] })
    .returning({ startedAt: attempts.startedAt });
  if (inserted.length > 0) return ok(inserted[0]);
  const [existing] = await db
    .select({ startedAt: attempts.startedAt })
    .from(attempts)
    .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, user.id)));
  return ok(existing);
}

export async function submitAttempt(
  db: Database,
  user: User,
  publicId: string,
  points: readonly NormalizedPoint[],
  now: Date,
): Promise<ActionResult<AttemptResult>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const playable = requirePlayable(loaded.data, user, now);
  if (!playable.ok) return playable;
  const game = playable.data;
  if (game.imageWidth === null || game.imageHeight === null) return fail("NOT_ACTIVE", "Game image missing");
  const image = { width: game.imageWidth, height: game.imageHeight };

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, user.id)));
    if (!attempt) return fail("NOT_STARTED", "Press Start before submitting");
    if (attempt.submittedAt !== null) return fail("ALREADY_SUBMITTED", "You have already submitted");

    const objs = await tx
      .select({ id: objects.id, x: objects.x, y: objects.y, radius: objects.radius })
      .from(objects)
      .where(eq(objects.gameId, game.id))
      .orderBy(asc(objects.sortOrder));
    const countCheck = validateMarkerCount(points.length, objs.length);
    if (!countCheck.ok) return countCheck;
    const scorable = objs.flatMap((o) => (o.x === null || o.y === null || o.radius === null ? [] : [{ id: o.id, x: o.x, y: o.y, radius: o.radius }]));
    const score = scoreAttempt({ markers: points, objects: scorable, image });

    // Handoff rule: the conditional UPDATE is the double-submit guard.
    const updated = await tx
      .update(attempts)
      .set({ submittedAt: now, foundCount: score.foundCount })
      .where(and(eq(attempts.id, attempt.id), eq(attempts.submittedAt, null as unknown as Date)))
      .returning({ elapsedMs: attempts.elapsedMs });
    if (updated.length === 0) return fail("ALREADY_SUBMITTED", "You have already submitted");
    // NOTE: drizzle expresses IS NULL as `isNull(attempts.submittedAt)`; use that instead of eq(…, null).

    await tx.insert(markers).values(
      points.map((p, i) => ({ attemptId: attempt.id, x: p.x, y: p.y, matchedObjectId: score.assignments[i] })),
    );
    const elapsedMs = updated[0].elapsedMs;
    if (elapsedMs === null) throw new Error("elapsed_ms not generated");
    return ok({ foundCount: score.foundCount, elapsedMs });
  });
}

export async function getPlayerState(db: Database, user: User, publicId: string, now: Date): Promise<ActionResult<PlayerAttemptState>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  void now;
  const [attempt] = await db
    .select({ startedAt: attempts.startedAt, submittedAt: attempts.submittedAt, foundCount: attempts.foundCount, elapsedMs: attempts.elapsedMs })
    .from(attempts)
    .where(and(eq(attempts.gameId, loaded.data.id), eq(attempts.userId, user.id)));
  if (!attempt) return ok({ kind: "not_started" });
  if (attempt.submittedAt === null || attempt.foundCount === null || attempt.elapsedMs === null) {
    return ok({ kind: "in_progress", startedAt: attempt.startedAt });
  }
  return ok({ kind: "submitted", result: { foundCount: attempt.foundCount, elapsedMs: attempt.elapsedMs } });
}

/** Hidden until the viewer has submitted (SPEC §3.4), except to the master and once finished. */
export async function getLeaderboard(db: Database, viewer: User | null, publicId: string, now: Date): Promise<ActionResult<LeaderboardEntry[]>> {
  const loaded = await loadByPublicId(db, publicId);
  if (!loaded.ok) return loaded;
  const game = loaded.data;
  const status = deriveStatus(game, now);
  const isMaster = viewer !== null && viewer.id === game.masterId;
  if (!isMaster && status !== "finished") {
    if (viewer === null) return fail("LEADERBOARD_HIDDEN", "Submit your attempt to see the leaderboard");
    const [own] = await db
      .select({ submittedAt: attempts.submittedAt })
      .from(attempts)
      .where(and(eq(attempts.gameId, game.id), eq(attempts.userId, viewer.id)));
    if (!own || own.submittedAt === null) return fail("LEADERBOARD_HIDDEN", "Submit your attempt to see the leaderboard");
  }
  const rows = await db
    .select({ userId: attempts.userId, userName: users.name, email: users.email, foundCount: attempts.foundCount, elapsedMs: attempts.elapsedMs })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.userId))
    .where(and(eq(attempts.gameId, game.id), isNotNull(attempts.submittedAt)))
    .orderBy(desc(attempts.foundCount), asc(attempts.elapsedMs), asc(attempts.submittedAt));
  return ok(
    rows.map((r, i) => ({
      rank: i + 1,
      userName: r.userName ?? r.email.split("@")[0],
      foundCount: r.foundCount ?? 0,
      elapsedMs: r.elapsedMs ?? 0,
      isViewer: viewer !== null && r.userId === viewer.id,
    })),
  );
}
```
Replace the `eq(attempts.submittedAt, null …)` line with `isNull(attempts.submittedAt)` (import `isNull` from drizzle-orm) and delete the NOTE comment before committing — the snippet shows the intent; the real code uses `isNull`.

- [ ] **Step 4: Run, verify, commit**

```bash
npm run test:integration && npm run verify && git add -A && git commit -m "feat(platform): play core — start, submit, state, leaderboard

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Server actions

**Files:**
- Create: `src/lib/games/actions.ts`
- Test: none new (wrappers are one line each; core is tested). Typecheck + lint cover them.

**Interfaces:**
- Produces `"use server"` exports with the same names as core, minus `(db, user)`: `createGameAction(input)`, `updateGameAction(gameId, input)`, `deleteGameAction(gameId)`, `addObjectAction(gameId, input)`, `updateObjectAction(objectId, input)`, `confirmObjectAction(objectId)`, `removeObjectAction(objectId)`, `setWindowAction(gameId, input)`, `publishGameAction(gameId)`, `unpublishGameAction(gameId)`, `startAttemptAction(publicId)`, `submitAttemptAction(publicId, points)`, `getPlayerStateAction(publicId)`, `getLeaderboardAction(publicId)`. All return `Promise<ActionResult<…>>`; `UNAUTHENTICATED` when no session.

- [ ] **Step 1: Implement**

`src/lib/games/actions.ts`:
```ts
"use server";
/**
 * Thin wrappers: resolve the user, call core, revalidate. No logic here.
 * Canvas (Phase 3) and the master pages call these; nothing else is exported to the client.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import type { NormalizedPoint } from "@/lib/types";
import * as core from "./games";
import * as play from "./play";
import { fail, type ActionResult } from "./result";

type Input<F> = F extends (db: never, user: never, ...rest: infer R) => unknown ? R : never;

async function withUser<T>(fn: (user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  return fn(user);
}

const touched = (gameId: string) => {
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
};

export async function createGameAction(input: Input<typeof core.createGame>[0]) {
  return withUser(async (u) => {
    const r = await core.createGame(getDb(), u, input);
    if (r.ok) revalidatePath("/games");
    return r;
  });
}
export async function updateGameAction(gameId: string, input: Input<typeof core.updateGame>[1]) {
  return withUser(async (u) => { const r = await core.updateGame(getDb(), u, gameId, input); touched(gameId); return r; });
}
export async function deleteGameAction(gameId: string) {
  return withUser(async (u) => { const r = await core.deleteGame(getDb(), u, gameId); touched(gameId); return r; });
}
export async function addObjectAction(gameId: string, input: Input<typeof core.addObject>[1]) {
  return withUser(async (u) => { const r = await core.addObject(getDb(), u, gameId, input); touched(gameId); return r; });
}
export async function updateObjectAction(gameId: string, objectId: string, input: Input<typeof core.updateObject>[1]) {
  return withUser(async (u) => { const r = await core.updateObject(getDb(), u, objectId, input); touched(gameId); return r; });
}
export async function confirmObjectAction(gameId: string, objectId: string) {
  return withUser(async (u) => { const r = await core.confirmObject(getDb(), u, objectId); touched(gameId); return r; });
}
export async function removeObjectAction(gameId: string, objectId: string) {
  return withUser(async (u) => { const r = await core.removeObject(getDb(), u, objectId); touched(gameId); return r; });
}
export async function setWindowAction(gameId: string, input: { startsAt: Date; endsAt: Date }) {
  return withUser(async (u) => { const r = await core.setWindow(getDb(), u, gameId, input, new Date()); touched(gameId); return r; });
}
export async function publishGameAction(gameId: string) {
  return withUser(async (u) => { const r = await core.publishGame(getDb(), u, gameId, new Date()); touched(gameId); return r; });
}
export async function unpublishGameAction(gameId: string) {
  return withUser(async (u) => { const r = await core.unpublishGame(getDb(), u, gameId, new Date()); touched(gameId); return r; });
}

// --- play (called by the Phase 3 play surface) ---
export async function startAttemptAction(publicId: string) {
  return withUser((u) => play.startAttempt(getDb(), u, publicId, new Date()));
}
export async function submitAttemptAction(publicId: string, points: NormalizedPoint[]) {
  return withUser((u) => play.submitAttempt(getDb(), u, publicId, points, new Date()));
}
export async function getPlayerStateAction(publicId: string) {
  return withUser((u) => play.getPlayerState(getDb(), u, publicId, new Date()));
}
export async function getLeaderboardAction(publicId: string) {
  return play.getLeaderboard(getDb(), await getCurrentUser(), publicId, new Date());
}
```
If the `Input<>` helper fights the compiler, replace each with the explicit parameter type from the core signature — the goal is no duplicated validation, not clever types.

- [ ] **Step 2: Verify, commit**

```bash
npm run verify && git add -A && git commit -m "feat(platform): server action wrappers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Master pages — list, new, edit, publish

**Files:**
- Create: `src/app/(master)/layout.tsx`, `src/app/(master)/games/page.tsx`, `src/app/(master)/games/new/page.tsx`, `src/app/(master)/games/[id]/page.tsx`, `src/app/(master)/games/[id]/upload-field.tsx`, `src/app/(master)/games/[id]/window-fields.tsx`, `src/app/(master)/games/[id]/object-row.tsx`
- Modify: `src/app/page.tsx` (link to `/games`)

**Interfaces:**
- Consumes: actions (Task 8), `requestUploadUrl` (Task 4), `loadGameForMasterById`, `listGamesForMaster` (Task 6), `MasterGameView`.

Design rules for these pages: server components by default; forms post to server actions; a failed action redirects back with `?error=<message>` and the page renders it; no coordinates are editable here (the canvas stream owns dragging) — positions display read-only with a **Confirm** button. Keep styling to Tailwind utility classes already in `globals.css`.

- [ ] **Step 1: Layout and list**

`src/app/(master)/layout.tsx`:
```tsx
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/games" className="font-semibold">Spotted</Link>
        <UserButton />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">{children}</main>
    </div>
  );
}
```

`src/app/(master)/games/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { listGamesForMaster } from "@/lib/games/queries";

export default async function GamesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const list = await listGamesForMaster(getDb(), user.id, new Date());
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My games</h1>
        <Link href="/games/new" className="rounded bg-black px-3 py-2 text-white">New game</Link>
      </div>
      {list.length === 0 ? (
        <p className="text-neutral-500">No games yet.</p>
      ) : (
        <ul className="divide-y">
          {list.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-3">
              <Link href={`/games/${g.id}`}>{g.title}</Link>
              <span className="rounded bg-neutral-100 px-2 py-1 text-xs uppercase">{g.status}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 2: New game form**

`src/app/(master)/games/new/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createGameAction } from "@/lib/games/actions";

export default async function NewGamePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  async function create(formData: FormData) {
    "use server";
    const r = await createGameAction({
      title: String(formData.get("title") ?? ""),
      generalPrompt: String(formData.get("generalPrompt") ?? ""),
    });
    if (!r.ok) redirect(`/games/new?error=${encodeURIComponent(r.message)}`);
    redirect(`/games/${r.data.id}`);
  }
  return (
    <form action={create} className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">New game</h1>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
      <label className="flex flex-col gap-1">Title<input name="title" required maxLength={120} className="rounded border p-2" /></label>
      <label className="flex flex-col gap-1">Style / difficulty prompt<textarea name="generalPrompt" maxLength={500} className="rounded border p-2" /></label>
      <button type="submit" className="self-start rounded bg-black px-3 py-2 text-white">Create</button>
    </form>
  );
}
```

- [ ] **Step 3: Client components — upload and window**

`src/app/(master)/games/[id]/upload-field.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { requestUploadUrl } from "@/lib/games/upload";
import type { AssetKind } from "@/lib/storage";

/** Browser → presigned PUT. On success calls `onUploaded(key)`; the server never sees the bytes. */
export function UploadField({ gameId, kind, onUploaded, label }: {
  gameId: string;
  kind: AssetKind;
  label: string;
  onUploaded: (key: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          start(async () => {
            setError(null);
            const r = await requestUploadUrl({ gameId, kind, contentType: file.type });
            if (!r.ok) return setError(r.message);
            const put = await fetch(r.data.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
            if (!put.ok) return setError(`Upload failed (${put.status})`);
            await onUploaded(r.data.key);
          });
        }}
      />
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </label>
  );
}
```

`src/app/(master)/games/[id]/window-fields.tsx`:
```tsx
"use client";
import { useState } from "react";

/**
 * datetime-local is wall-clock time in the browser's zone. The browser converts to an
 * ISO instant here — the display boundary — and the server only ever sees UTC (invariant 6).
 */
export function WindowFields({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
  const [start, setStart] = useState(toLocal(startsAt));
  const [end, setEnd] = useState(toLocal(endsAt));
  const iso = (local: string) => (local ? new Date(local).toISOString() : "");
  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1">Starts<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border p-2" required /></label>
      <label className="flex flex-col gap-1">Ends<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border p-2" required /></label>
      <input type="hidden" name="startsAt" value={iso(start)} />
      <input type="hidden" name="endsAt" value={iso(end)} />
    </div>
  );
}
```
(`toLocal` uses the ISO string sliced — that is UTC wall time, not local. Correct it: build the local string with `getFullYear()/getMonth()+1/getDate()/getHours()/getMinutes()` zero-padded. Do this in the implementation; the test in Step 5 catches it.)

- [ ] **Step 4: Edit page**

`src/app/(master)/games/[id]/object-row.tsx`:
```tsx
import type { ObjectForMaster } from "@/lib/types";
import { confirmObjectAction, removeObjectAction } from "@/lib/games/actions";

export function ObjectRow({ gameId, object, editable }: { gameId: string; object: ObjectForMaster; editable: boolean }) {
  const confirm = confirmObjectAction.bind(null, gameId, object.id);
  const remove = removeObjectAction.bind(null, gameId, object.id);
  const pos = object.x === null ? "no position yet" : `x ${object.x.toFixed(3)} · y ${object.y?.toFixed(3)} · r ${object.radius?.toFixed(3)}`;
  return (
    <li className="flex items-center gap-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={object.sourceImageUrl} alt={object.label} className="h-12 w-12 rounded object-cover" />
      <div className="flex-1">
        <div className="font-medium">{object.label}</div>
        <div className="text-xs text-neutral-500">{pos}</div>
      </div>
      <span className={`rounded px-2 py-1 text-xs ${object.confirmed ? "bg-green-100" : "bg-amber-100"}`}>{object.confirmed ? "confirmed" : "unconfirmed"}</span>
      {editable && (
        <>
          <form action={confirm}><button disabled={object.x === null || object.confirmed} className="rounded border px-2 py-1 text-sm disabled:opacity-40">Confirm</button></form>
          <form action={remove}><button className="rounded border px-2 py-1 text-sm">Remove</button></form>
        </>
      )}
    </li>
  );
}
```

`src/app/(master)/games/[id]/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { addObjectAction, publishGameAction, setWindowAction, unpublishGameAction, updateGameAction } from "@/lib/games/actions";
import { loadGameForMasterById } from "@/lib/games/queries";
import { MAX_OBJECTS_PER_GAME } from "@/lib/types";
import { ObjectRow } from "./object-row";
import { UploadField } from "./upload-field";
import { WindowFields } from "./window-fields";

export default async function EditGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const game = await loadGameForMasterById(getDb(), id, user.id, new Date());
  if (!game) notFound();
  const editable = game.status === "draft";
  const back = (r: { ok: boolean; message?: string }) => redirect(`/games/${id}${r.ok ? "" : `?error=${encodeURIComponent(r.message ?? "")}`}`);

  async function saveBackground(key: string) { "use server"; back(await updateGameAction(id, { backgroundKey: key })); }
  async function addObject(formData: FormData) {
    "use server";
    back(await addObjectAction(id, { label: String(formData.get("label") ?? ""), prompt: String(formData.get("prompt") ?? ""), sourceImageKey: String(formData.get("sourceImageKey") ?? "") }));
  }
  async function saveWindow(formData: FormData) {
    "use server";
    back(await setWindowAction(id, { startsAt: new Date(String(formData.get("startsAt"))), endsAt: new Date(String(formData.get("endsAt"))) }));
  }
  async function publish() { "use server"; back(await publishGameAction(id)); }
  async function unpublish() { "use server"; back(await unpublishGameAction(id)); }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{game.title}</h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs uppercase">{game.status}</span>
      </header>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}

      <section>
        <h2 className="mb-2 font-medium">Background</h2>
        {game.backgroundUrl ? <img src={game.backgroundUrl} alt="" className="max-h-64 rounded" /> : <p className="text-neutral-500">None yet.</p>}
        {editable && <UploadField gameId={id} kind="background" label="Upload background" onUploaded={saveBackground} />}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Objects ({game.objects.length}/{MAX_OBJECTS_PER_GAME})</h2>
        <ul className="divide-y">{game.objects.map((o) => <ObjectRow key={o.id} gameId={id} object={o} editable={editable} />)}</ul>
        {editable && game.objects.length < MAX_OBJECTS_PER_GAME && (
          <AddObjectForm gameId={id} action={addObject} />
        )}
      </section>

      <section>
        <h2 className="mb-2 font-medium">Window</h2>
        <form action={saveWindow} className="flex flex-col gap-3">
          <WindowFields startsAt={game.startsAt?.toISOString() ?? null} endsAt={game.endsAt?.toISOString() ?? null} />
          {editable && <button className="self-start rounded border px-3 py-2">Save window</button>}
        </form>
      </section>

      <section className="flex gap-3">
        {editable ? (
          <form action={publish}><button className="rounded bg-black px-3 py-2 text-white">Publish</button></form>
        ) : game.status === "scheduled" ? (
          <form action={unpublish}><button className="rounded border px-3 py-2">Unpublish</button></form>
        ) : null}
        <a href={`/g/${game.publicId}`} className="self-center text-sm underline">/g/{game.publicId}</a>
      </section>
    </div>
  );
}
```
`AddObjectForm` is a small client component in the same folder (`add-object-form.tsx`): label + prompt inputs, an `UploadField kind="object"` that stores the returned key in a hidden `sourceImageKey` input via state, and a submit button that calls the passed server action with the form data. Keep it under 40 lines.

Add `<img>` eslint disables as in `ObjectRow`, or use `next/image` with `unoptimized` — presigned URLs are not static hosts.

Also update `src/app/page.tsx` to a one-line landing with a link to `/games` (replace the create-next-app boilerplate).

- [ ] **Step 5: Manual walkthrough (this is the acceptance check for §8 "upload to published without touching a coordinate")**

`npm run dev`, sign in, create a game, upload a background and one object, set a window. Publish → expect the error `Generate the image first` (imagegen isn't built). Temporarily set `generated_image_key`, `image_width`, `image_height`, and the object's `x/y/radius` via `npx drizzle-kit studio`, click **Confirm** on the object, then **Publish** → status `scheduled`. Unpublish → `draft`. Set the window in your local zone and check the DB stores the correct UTC instant.

- [ ] **Step 6: Verify, commit**

```bash
npm run verify && git add -A && git commit -m "feat(platform): master pages — list, create, edit, publish

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: CI integration job

**Files:**
- Modify: `.github/workflows/ci.yml`, `docs/SYSTEM.md` §5.1 table (one row), `.env.example` (comment)

- [ ] **Step 1: Add the job**

In `.github/workflows/ci.yml`, after `unused`:
```yaml
  integration:
    name: Integration (Neon)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Migrate the CI branch
        if: ${{ secrets.TEST_DATABASE_URL != '' }}
        env:
          DATABASE_URL_UNPOOLED: ${{ secrets.TEST_DATABASE_URL_UNPOOLED }}
        run: npx drizzle-kit migrate
      - name: Run integration tests
        if: ${{ secrets.TEST_DATABASE_URL != '' }}
        env:
          TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
        run: npm run test:integration
      - if: ${{ secrets.TEST_DATABASE_URL == '' }}
        run: echo "::warning::TEST_DATABASE_URL secret not set; integration tests skipped"
```
GitHub does not allow `secrets` in `if:` directly — use a first step that writes `has_db=true/false` to `$GITHUB_OUTPUT` from `env: { URL: ${{ secrets.TEST_DATABASE_URL }} }` and gate the later steps on that output.

Add `integration` to the `needs:` lists of `report` and `update-baseline`, and a `typecheck`-style pass/fail row in the report script (`INTEGRATION_RESULT: ${{ needs.integration.result }}`).

- [ ] **Step 2: Secrets**

The user creates a Neon branch `ci` from `main`, and adds GitHub secrets `TEST_DATABASE_URL` (pooled) and `TEST_DATABASE_URL_UNPOOLED` (direct). Push, confirm the job runs green.

- [ ] **Step 3: SYSTEM.md row and commit**

Add to SYSTEM.md §5.1: `| Integration (Vitest + Neon branch) | CI | ~30s | Publish transaction, double-submit, timing, leaderboard visibility |`.
```bash
npm run verify && git add -A && git commit -m "ci: integration tests against a Neon branch

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Phase close-out

- [ ] Run `/phase-handoff` (verify, integration-reviewer, `docs/handoffs/phase-1.md`, dev log entry, commit). Expect the reviewer to probe: every page and action for a bypass of `projectGame`; `submitAttempt` under concurrency; `WindowFields` zone handling; `proxy.ts` public-route list.
- [ ] Open PR `stream/platform` → `main`.

---

## Self-review

**Spec coverage.** §3.1.1–3 create/upload/prompts → Tasks 4, 5, 9. §3.1.6 confirm → Task 5 (`confirmObject`), drag is Phase 3. §3.1.7 window + publish → Tasks 5, 9. §3.2 derived status → Phase 0 + Task 6. §3.3.1 404 for non-active → Task 6 (`null` → `notFound()` in the Phase 3 page; `loadGameForViewer` tested). §3.3.2 server `started_at` → Task 7. §3.3.4 exactly N → Task 7. §3.3.6 one submission → Task 7. §3.3.7 result count+time only → Task 7 (`AttemptResult`). §3.4 ranking, unique constraint → Task 7. Leaderboard hidden pre-submit → Task 7. §11 master cannot play → Task 7. §5.2 users mirror → Task 3. §8 "generation failure surfaces a reason" → Phase 2. §8 E2E → still owed (Phase 0 gap, unchanged).

**Placeholders.** `AddObjectForm` is described, not shown — acceptable as a ≤40-line client form whose every input is named in Task 9 Step 4. No TBDs.

**Type consistency.** `ActionResult`/`fail`/`ok` (Task 2) used identically in Tasks 4–8. `Database` from Task 1 everywhere. `urlResolverFor` (Task 4) matches the `Resolver` type in Task 6. `AttemptResult`, `PlayerAttemptState`, `LeaderboardEntry` from `src/lib/types.ts` (frozen) match the Task 7 returns. `updateObjectAction`/`confirmObjectAction`/`removeObjectAction` take `(gameId, objectId, …)` in Task 8 and are bound that way in Task 9.
