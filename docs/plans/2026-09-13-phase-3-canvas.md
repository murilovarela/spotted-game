# Phase 3 — Canvas, Play Surface, E2E Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `MarkerCanvas` in three modes, the `/g/[publicId]` play surface, drag-to-confirm authoring, a seed with every lifecycle state, and a Playwright harness that drives a seeded game to a scored submission in CI.

**Architecture:** Pure geometry/reducer/format modules carry every calculation and are unit-tested in the ratchet; `MarkerCanvas` is a thin controlled client component rendering an SVG overlay in image-pixel space over the `<img>`. Pages are server components that call Phase 1 actions; the Start-screen tree cannot receive the image by prop shape. The seed drives Phase 1 core functions with a shifted `now` so every row is written under the same locks the app uses. E2E signs in through Clerk's server-side sign-in token (`@clerk/testing`) and reads seed output from a JSON file written by global setup.

**Tech Stack:** Next.js 16 App Router, React 19 (`useReducer`, `useTransition`, `useSyncExternalStore`), SVG, Playwright 1.63 + `@clerk/testing`, `tsx` for the seed, Vitest 5.

**Spec:** `docs/specs/2026-09-13-phase-3-canvas-design.md` (design), `docs/SPEC.md` §3.3, §3.4, §6.3, §8, §11, `docs/handoffs/phase-1.md` (contracts + do-not-break).

## Global Constraints

- Node `22.23.2` (`.nvmrc`); run `npm run verify` before every commit (Stop hook runs it). `npm run test:cov` must stay ≥ `quality-baseline.json` coverage (96.77) once the canvas pure modules are opted into coverage in Task 1.
- TypeScript strict, no `any`. Drizzle only. No raw SQL.
- **Frozen contract:** `src/db/schema.ts`, `src/lib/types.ts`, `src/lib/visibility.ts`, `src/lib/scoring.ts`. Do not edit. If a task seems to need it, stop and flag.
- **Invariant 1 / image-before-Start:** `src/app/g/[publicId]` renders a Start-only tree whose props cannot carry `image`. Nothing under `src/app/g` or `src/components/canvas` reads `objects.x/y/radius` except from `FinishedGameView` / `MasterGameView`.
- **Lock discipline:** never write `objects.x/y/radius/confirmed` or `games.generated_image_key` directly — go through `updateObjectAction` / `setGeneratedImage` / `confirmObject`.
- **Server time only:** `Timer` is display-only. No client timestamp is ever sent to an action.
- **Validate at the boundary:** the canvas builds coordinates with `normalized()`/`clamp01`; actions re-validate with `isNormalized` (Phase 1 already does).
- Stream C owns `src/components/canvas/**`, `src/app/g/**`, `e2e/**`, `playwright.config.ts`, `src/db/seed/**`. Touching `src/app/(master)/games/[id]/` (Task 6), `src/lib/storage.ts` (one `putObject` export, Task 2), `vitest.config.ts`, `knip.json`, `package.json`, `.github/workflows/ci.yml`, `.env.example` is explicitly allowed by this plan; nothing else outside the stream.
- Never write `.env*` files. Add variable names to `.env.example` only.
- Colocate unit tests as `__tests__/*.test.ts`. E2E lives in `e2e/*.spec.ts`.
- `"use server"` files export only async functions; inline server actions close over serializable values only. Client components: no `setState` inside `useEffect` (`react-hooks/set-state-in-effect` is an error) — use `useSyncExternalStore` or event handlers.
- Commit after every task with this exact two-line footer, nothing else in the footer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB`

---

## File map

| File | Responsibility |
| --- | --- |
| `src/components/canvas/geometry.ts` | Pure: pointer→normalized, normalized→pixel, radius, nudge, handle→radius |
| `src/components/canvas/marker-state.ts` | Pure reducer for play-mode markers (add/move/remove/select, cap) |
| `src/components/canvas/format.ts` | Pure: `formatElapsed` |
| `src/components/canvas/marker-canvas.tsx` | Client. Controlled SVG-over-img canvas, modes `play`/`author`/`reveal` |
| `src/components/canvas/trash-zone.tsx` | Drop target; a marker released over it is removed |
| `src/components/canvas/timer.tsx` | Client. Ticks from server `startedAt` with server-offset |
| `src/components/canvas/object-rail.tsx` | Object thumbnails, always visible |
| `src/components/canvas/leaderboard.tsx` | Rank table; highlights the viewer |
| `src/app/g/[publicId]/page.tsx` | Server. Loads the view, branches by status/state |
| `src/app/g/[publicId]/start-screen.tsx` | Server. Props exclude `image` by type |
| `src/app/g/[publicId]/play-screen.tsx` | Client. Canvas + rail + timer + trash + submit dialog |
| `src/app/g/[publicId]/result-screen.tsx` | Server. Found/elapsed + leaderboard, no markers |
| `src/app/g/[publicId]/finished-screen.tsx` | Server. Reveal canvas + leaderboard |
| `src/app/(master)/games/[id]/author-canvas.tsx` | Client. Author-mode canvas wired to `updateObjectAction` |
| `src/db/seed/fixtures/objects.json` | Single source of fixture object labels/positions |
| `src/db/seed/fixtures/make.mjs` | One-off PNG generator (pure Node) for the fixtures |
| `src/db/seed/fixtures/*.png` | Committed fixture images |
| `src/db/seed/index.ts` | `npm run seed` |
| `e2e/global-setup.ts` | Ensure Clerk test user, seed, sign in, save storage state |
| `e2e/seed-data.ts` | Reads `e2e/.auth/seed.json` |
| `e2e/play.spec.ts`, `e2e/lifecycle.spec.ts`, `e2e/author.spec.ts` | Acceptance flows |
| `playwright.config.ts` | Config |
| `.github/workflows/ci.yml` | `e2e` job |

---

### Task 1: Pure canvas modules

**Files:**
- Create: `src/components/canvas/geometry.ts`
- Create: `src/components/canvas/marker-state.ts`
- Create: `src/components/canvas/format.ts`
- Test: `src/components/canvas/__tests__/geometry.test.ts`, `marker-state.test.ts`, `format.test.ts`
- Modify: `vitest.config.ts` (coverage include)

**Interfaces:**
- Consumes: `normalized`, `Normalized`, `NormalizedPoint`, `NormalizedCircle`, `ImageSize` from `@/lib/types`.
- Produces (used by Tasks 3, 5, 6):
  - `Rect = { left; top; width; height }`
  - `clamp01(n: number): Normalized`
  - `toNormalized(clientX, clientY, rect, opts: { clamp: boolean }): NormalizedPoint | null`
  - `toPixel(p: NormalizedPoint, image: ImageSize): { x: number; y: number }`
  - `radiusPx(radius: Normalized, image: ImageSize): number`
  - `radiusFromHandle(center: NormalizedPoint, handle: NormalizedPoint, image: ImageSize): Normalized`
  - `nudge(p: NormalizedPoint, dx: -1 | 0 | 1, dy: -1 | 0 | 1): NormalizedPoint`
  - `NUDGE_STEP = 0.005`, `MIN_RADIUS = 0.01`, `MAX_RADIUS = 0.5`, `DEFAULT_RADIUS = 0.05`
  - `PlayMarker = { id: string; x: Normalized; y: Normalized }`, `MarkerState`, `MarkerAction`, `EMPTY_MARKERS`, `markerReducer(state, action, max)`, `canSubmit(state, required)`
  - `formatElapsed(ms: number): string`

- [ ] **Step 1: Write the failing geometry tests**

`src/components/canvas/__tests__/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalized } from "@/lib/types";
import {
  clamp01,
  MIN_RADIUS,
  MAX_RADIUS,
  NUDGE_STEP,
  nudge,
  radiusFromHandle,
  radiusPx,
  toNormalized,
  toPixel,
} from "../geometry";

const rect = { left: 100, top: 50, width: 400, height: 300 };
const image = { width: 1024, height: 768 };

describe("clamp01", () => {
  it("clamps into [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });
});

describe("toNormalized", () => {
  it("maps a pointer inside the rect", () => {
    expect(toNormalized(200, 125, rect, { clamp: false })).toEqual({ x: 0.25, y: 0.25 });
  });
  it("returns null outside the rect when not clamping", () => {
    expect(toNormalized(99, 125, rect, { clamp: false })).toBeNull();
    expect(toNormalized(200, 351, rect, { clamp: false })).toBeNull();
  });
  it("clamps outside the rect when clamping (drag past the edge)", () => {
    expect(toNormalized(0, 0, rect, { clamp: true })).toEqual({ x: 0, y: 0 });
    expect(toNormalized(900, 900, rect, { clamp: true })).toEqual({ x: 1, y: 1 });
  });
  it("includes the boundary", () => {
    expect(toNormalized(500, 350, rect, { clamp: false })).toEqual({ x: 1, y: 1 });
  });
  it("returns null for a degenerate rect", () => {
    expect(toNormalized(0, 0, { ...rect, width: 0 }, { clamp: true })).toBeNull();
  });
});

describe("toPixel / radiusPx", () => {
  it("scales by the image dimensions", () => {
    expect(toPixel({ x: normalized(0.5), y: normalized(0.25) }, image)).toEqual({ x: 512, y: 192 });
  });
  it("radius is a fraction of width (plain circle in pixel space)", () => {
    expect(radiusPx(normalized(0.05), image)).toBe(51.2);
  });
});

describe("radiusFromHandle", () => {
  const center = { x: normalized(0.5), y: normalized(0.5) };
  it("measures pixel distance and divides by width", () => {
    // handle 0.1 right in normalized x = 102.4px → 0.1
    expect(radiusFromHandle(center, { x: normalized(0.6), y: normalized(0.5) }, image)).toBeCloseTo(0.1, 10);
  });
  it("is aspect-aware: vertical offset is scaled by height/width", () => {
    // 0.1 down in normalized y = 76.8px → 0.075 of width
    expect(radiusFromHandle(center, { x: normalized(0.5), y: normalized(0.6) }, image)).toBeCloseTo(0.075, 10);
  });
  it("clamps to [MIN_RADIUS, MAX_RADIUS]", () => {
    expect(radiusFromHandle(center, center, image)).toBe(MIN_RADIUS);
    expect(radiusFromHandle({ x: normalized(0), y: normalized(0) }, { x: normalized(1), y: normalized(1) }, image)).toBe(MAX_RADIUS);
  });
});

describe("nudge", () => {
  it("moves by one step and clamps", () => {
    expect(nudge({ x: normalized(0.5), y: normalized(0.5) }, 1, 0)).toEqual({ x: 0.5 + NUDGE_STEP, y: 0.5 });
    expect(nudge({ x: normalized(0), y: normalized(1) }, -1, 1)).toEqual({ x: 0, y: 1 });
  });
});
```

- [ ] **Step 2: Write the failing reducer and format tests**

`src/components/canvas/__tests__/marker-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalized } from "@/lib/types";
import { canSubmit, EMPTY_MARKERS, markerReducer, type MarkerState } from "../marker-state";

const p = (x: number, y: number) => ({ x: normalized(x), y: normalized(y) });
const add = (s: MarkerState, id: string, max = 3) => markerReducer(s, { type: "add", id, point: p(0.1, 0.1) }, max);

describe("markerReducer", () => {
  it("adds and selects", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(s.markers).toEqual([{ id: "a", x: 0.1, y: 0.1 }]);
    expect(s.selected).toBe("a");
  });
  it("refuses to add past max", () => {
    const s = add(add(add(EMPTY_MARKERS, "a"), "b"), "c");
    expect(add(s, "d")).toBe(s);
  });
  it("moves an existing marker and ignores unknown ids", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(markerReducer(s, { type: "move", id: "a", point: p(0.7, 0.8) }, 3).markers[0]).toEqual({ id: "a", x: 0.7, y: 0.8 });
    expect(markerReducer(s, { type: "move", id: "zz", point: p(0.7, 0.8) }, 3)).toBe(s);
  });
  it("removes and clears selection when the selected one goes", () => {
    const s = add(add(EMPTY_MARKERS, "a"), "b");
    const r = markerReducer(s, { type: "remove", id: "b" }, 3);
    expect(r.markers.map((m) => m.id)).toEqual(["a"]);
    expect(r.selected).toBeNull();
    expect(markerReducer(s, { type: "remove", id: "a" }, 3).selected).toBe("b");
  });
  it("selects", () => {
    const s = add(EMPTY_MARKERS, "a");
    expect(markerReducer(s, { type: "select", id: null }, 3).selected).toBeNull();
  });
});

describe("canSubmit", () => {
  it("requires exactly N markers", () => {
    const s = add(add(EMPTY_MARKERS, "a"), "b");
    expect(canSubmit(s, 2)).toBe(true);
    expect(canSubmit(s, 3)).toBe(false);
    expect(canSubmit(s, 1)).toBe(false);
  });
});
```

`src/components/canvas/__tests__/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatElapsed } from "../format";

describe("formatElapsed", () => {
  it("formats m:ss.t", () => {
    expect(formatElapsed(0)).toBe("0:00.0");
    expect(formatElapsed(65_432)).toBe("1:05.4");
    expect(formatElapsed(599_999)).toBe("9:59.9");
    expect(formatElapsed(3_600_000)).toBe("60:00.0");
  });
  it("floors negatives and NaN to zero", () => {
    expect(formatElapsed(-5)).toBe("0:00.0");
    expect(formatElapsed(Number.NaN)).toBe("0:00.0");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/canvas`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the modules**

`src/components/canvas/geometry.ts`:

```ts
/**
 * Pure coordinate maths for the canvas. Radius is a fraction of image *width* (Phase 0
 * decision, mirrored in scoring.ts); in image-pixel space that is a plain circle, so
 * what the master sees is exactly the geometry players are scored against.
 */
import { normalized, type ImageSize, type Normalized, type NormalizedPoint } from "@/lib/types";

export type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** 1/200 of the frame per arrow-key press. */
export const NUDGE_STEP = 0.005;
export const MIN_RADIUS = 0.01;
export const MAX_RADIUS = 0.5;
export const DEFAULT_RADIUS = 0.05;

export function clamp01(n: number): Normalized {
  return normalized(Math.min(1, Math.max(0, n)));
}

/**
 * Pointer position → normalized point. With `clamp: false` a pointer outside the rect
 * yields `null` (a click outside the image adds nothing); with `clamp: true` it is
 * clamped (a drag past the edge pins the marker to the edge).
 */
export function toNormalized(clientX: number, clientY: number, rect: Rect, opts: { clamp: boolean }): NormalizedPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!opts.clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

export function toPixel(p: NormalizedPoint, image: ImageSize): { x: number; y: number } {
  return { x: p.x * image.width, y: p.y * image.height };
}

export function radiusPx(radius: Normalized, image: ImageSize): number {
  return radius * image.width;
}

/** Distance centre→handle in pixel space, as a fraction of width, clamped to the allowed range. */
export function radiusFromHandle(center: NormalizedPoint, handle: NormalizedPoint, image: ImageSize): Normalized {
  const c = toPixel(center, image);
  const h = toPixel(handle, image);
  const r = Math.hypot(h.x - c.x, h.y - c.y) / image.width;
  return normalized(Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r)));
}

export function nudge(p: NormalizedPoint, dx: -1 | 0 | 1, dy: -1 | 0 | 1): NormalizedPoint {
  return { x: clamp01(p.x + dx * NUDGE_STEP), y: clamp01(p.y + dy * NUDGE_STEP) };
}
```

`src/components/canvas/marker-state.ts`:

```ts
/** Play-mode marker state. Pure so the component stays thin and this stays unit-testable. */
import type { Normalized, NormalizedPoint } from "@/lib/types";

export type PlayMarker = { readonly id: string; readonly x: Normalized; readonly y: Normalized };

export type MarkerState = {
  readonly markers: readonly PlayMarker[];
  readonly selected: string | null;
};

export type MarkerAction =
  | { type: "add"; id: string; point: NormalizedPoint }
  | { type: "move"; id: string; point: NormalizedPoint }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null };

export const EMPTY_MARKERS: MarkerState = { markers: [], selected: null };

export function markerReducer(state: MarkerState, action: MarkerAction, max: number): MarkerState {
  switch (action.type) {
    case "add": {
      if (state.markers.length >= max) return state;
      return { markers: [...state.markers, { id: action.id, x: action.point.x, y: action.point.y }], selected: action.id };
    }
    case "move": {
      if (!state.markers.some((m) => m.id === action.id)) return state;
      return {
        ...state,
        markers: state.markers.map((m) => (m.id === action.id ? { ...m, x: action.point.x, y: action.point.y } : m)),
      };
    }
    case "remove":
      return {
        markers: state.markers.filter((m) => m.id !== action.id),
        selected: state.selected === action.id ? null : state.selected,
      };
    case "select":
      return { ...state, selected: action.id };
  }
}

/** SPEC §3.3.4: exactly N markers before submitting. */
export function canSubmit(state: MarkerState, required: number): boolean {
  return state.markers.length === required;
}
```

`src/components/canvas/format.ts`:

```ts
/** `m:ss.t` — minutes unbounded, tenths of a second. Display only. */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenths = Math.floor(safe / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenth}`;
}
```

- [ ] **Step 5: Opt the pure modules into coverage**

In `vitest.config.ts`, change `include: ["src/lib/**/*.ts"],` to:

```ts
      include: [
        "src/lib/**/*.ts",
        // Canvas pure layer (Phase 3): geometry, marker reducer, formatting. The components
        // that use them are verified by Playwright, not by line coverage.
        "src/components/canvas/geometry.ts",
        "src/components/canvas/marker-state.ts",
        "src/components/canvas/format.ts",
      ],
```

- [ ] **Step 6: Run tests, coverage, and verify**

Run: `npx vitest run src/components/canvas && npm run test:cov 2>&1 | tail -20 && npm run verify`
Expected: all PASS; `All files` coverage ≥ 96.77.

- [ ] **Step 7: Commit**

```bash
git add src/components/canvas vitest.config.ts
git commit -m "feat(canvas): pure geometry, marker reducer, and elapsed formatting

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 2: Seed with fixtures

**Files:**
- Create: `src/db/seed/fixtures/objects.json`, `src/db/seed/fixtures/make.mjs`, `src/db/seed/fixtures/{background,object-1,object-2,object-3,generated}.png` (generated by `make.mjs`, committed)
- Create: `src/db/seed/index.ts`
- Modify: `src/lib/storage.ts` (add `putObject`), `package.json` (`seed` script, `tsx` devDependency), `knip.json`, `.env.example`, `.gitignore`

**Interfaces:**
- Consumes: `createDb` (`@/db`), `upsertUser`-free inserts on `users`, core `createGame`, `updateGame`, `addObject`, `setGeneratedImage`, `confirmObject`, `setWindow`, `publishGame` (`@/lib/games/games`), `startAttempt`, `submitAttempt` (`@/lib/games/play`), `objectKey`, `putObject` (`@/lib/storage`).
- Produces (used by Task 7): `npm run seed -- --json` prints one JSON object to stdout:
  ```ts
  type SeedOutput = {
    masterId: string;
    mine: Record<"draft" | "scheduled" | "active" | "finished", { id: string; publicId: string }>;
    theirs: Record<"scheduled" | "active" | "finished", { id: string; publicId: string }>;
  };
  ```
  Game titles are `[seed] <state>` (mine) and `[seed] <state> (opponent)` (theirs). Env: `SEED_MASTER_ID` (default `seed-master`). `mine.draft` has 3 positioned objects, objects 1–2 confirmed, object 3 unconfirmed, window set (+1d → +2d), not published.

- [ ] **Step 1: Fixture positions**

`src/db/seed/fixtures/objects.json` — the single source for `make.mjs` and the seed:

```json
{
  "image": { "width": 1024, "height": 768 },
  "objects": [
    { "label": "Red ball", "file": "object-1.png", "shape": "circle", "color": [220, 50, 47], "x": 0.25, "y": 0.3, "radius": 0.06 },
    { "label": "Green box", "file": "object-2.png", "shape": "square", "color": [60, 160, 70], "x": 0.62, "y": 0.55, "radius": 0.06 },
    { "label": "Blue kite", "file": "object-3.png", "shape": "triangle", "color": [40, 90, 220], "x": 0.8, "y": 0.2, "radius": 0.06 }
  ]
}
```

- [ ] **Step 2: PNG generator (pure Node, no dependency)**

`src/db/seed/fixtures/make.mjs`:

```js
#!/usr/bin/env node
// Regenerates the committed fixture PNGs from objects.json. Run once: node src/db/seed/fixtures/make.mjs
// Pure Node PNG writer (8-bit RGB, no filter) so the seed has no image dependency.
import { crc32, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, "objects.json"), "utf8"));
const { width: W, height: H } = spec.image;
const OBJ = 96; // object sprite size in px

function png(w, h, px) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth, colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Background: soft gradient with a faint grid so drags are visually anchored.
const background = (x, y) => {
  const grid = x % 64 === 0 || y % 64 === 0 ? -18 : 0;
  return [Math.round(200 + 40 * (x / W)) + grid, Math.round(210 - 40 * (y / H)) + grid, 230 + grid];
};

// Sprite pixel test, in sprite-local coords (0..OBJ). Returns true when inside the shape.
function inside(shape, lx, ly) {
  const c = OBJ / 2;
  const dx = lx - c, dy = ly - c;
  if (shape === "circle") return dx * dx + dy * dy <= (c - 4) * (c - 4);
  if (shape === "square") return Math.abs(dx) <= c - 8 && Math.abs(dy) <= c - 8;
  // triangle: apex at top centre
  return ly >= 8 && ly <= OBJ - 8 && Math.abs(dx) <= (ly - 8) / 2;
}

for (const o of spec.objects) {
  writeFileSync(join(here, o.file), png(OBJ, OBJ, (x, y) => (inside(o.shape, x, y) ? o.color : [255, 255, 255])));
}
writeFileSync(join(here, "background.png"), png(W, H, background));
writeFileSync(
  join(here, "generated.png"),
  png(W, H, (x, y) => {
    for (const o of spec.objects) {
      const lx = x - Math.round(o.x * W - OBJ / 2);
      const ly = y - Math.round(o.y * H - OBJ / 2);
      if (lx >= 0 && lx < OBJ && ly >= 0 && ly < OBJ && inside(o.shape, lx, ly)) return o.color;
    }
    return background(x, y);
  }),
);
console.log("fixtures written");
```

Run: `node src/db/seed/fixtures/make.mjs && ls -la src/db/seed/fixtures/*.png`
Expected: five PNGs; open `generated.png` (Read tool) and confirm three shapes sit at the JSON positions.

- [ ] **Step 3: `putObject` in storage**

Append to `src/lib/storage.ts`:

```ts
/** Server-side upload (seed, generation). The app itself never proxies bytes — browsers use `presignPut`. */
export async function putObject(key: string, contentType: string, body: Uint8Array): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, Body: body }));
}
```

- [ ] **Step 4: Dependencies and scripts**

```bash
npm install -D tsx
```

In `package.json` scripts add `"seed": "tsx src/db/seed/index.ts"`.
In `knip.json` add `"src/db/seed/index.ts"` to `entry`.
In `.gitignore` append:

```
# e2e
/e2e/.auth/
/playwright-report/
/test-results/
```

In `.env.example` append under `# --- Integration tests ---` block end:

```
# --- Seed / E2E ---
# Clerk user id that owns the seeded games (`npm run seed`). Defaults to a fake "seed-master".
SEED_MASTER_ID=
# Optional: an existing Clerk user for Playwright. When unset, global setup finds or creates e2e@spotted.test.
E2E_CLERK_USER_ID=
```

- [ ] **Step 5: The seed**

`src/db/seed/index.ts`:

```ts
/**
 * `npm run seed [-- --json]` — demo games in every lifecycle state (SPEC §9.2) plus a
 * set owned by an opponent so the master account has something to play.
 *
 * Drives the Phase 1 core with a shifted `now` so every row goes through the same
 * validation and locks as the app. Idempotent: deletes games titled "[seed] …" first.
 * Uses DATABASE_URL (not TEST_DATABASE_URL) on purpose — this seeds whatever branch
 * the app points at; CI points DATABASE_URL at the test branch for E2E.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import { createDb, type Database } from "@/db";
import { games, users, type User } from "@/db/schema";
import { addObject, confirmObject, createGame, publishGame, setGeneratedImage, setWindow, updateGame } from "@/lib/games/games";
import { startAttempt, submitAttempt } from "@/lib/games/play";
import { objectKey, putObject } from "@/lib/storage";
import { normalized, type NormalizedPoint } from "@/lib/types";
import spec from "./fixtures/objects.json";

loadEnvConfig(process.cwd());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FIXTURES = join(process.cwd(), "src/db/seed/fixtures");
const PREFIX = "[seed] ";

type Ref = { id: string; publicId: string };
type Window = { startsAt: Date; endsAt: Date } | null;

function must<T>(r: { ok: true; data: T } | { ok: false; message: string }, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.message}`);
  return r.data;
}

async function ensureUser(db: Database, id: string, name: string): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ id, email: `${id}@spotted.test`, name })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  return existing;
}

async function upload(gameId: string, kind: "background" | "object" | "generated", file: string): Promise<string> {
  const key = objectKey(kind, gameId, "image/png");
  await putObject(key, "image/png", readFileSync(join(FIXTURES, file)));
  return key;
}

/** Create a fully-authored game. `confirmAll=false` leaves the last object unconfirmed. */
async function author(db: Database, master: User, title: string, confirmAll: boolean): Promise<Ref> {
  const ref = must(await createGame(db, master, { title, generalPrompt: "A bright cartoon room. Hide the objects in plain sight." }), title);
  must(await updateGame(db, master, ref.id, { backgroundKey: await upload(ref.id, "background", "background.png") }), "background");
  const proposals = [];
  for (const o of spec.objects) {
    const obj = must(
      await addObject(db, master, ref.id, { label: o.label, prompt: `Place the ${o.label.toLowerCase()} somewhere plausible.`, sourceImageKey: await upload(ref.id, "object", o.file) }),
      o.label,
    );
    proposals.push({ objectId: obj.id, x: normalized(o.x), y: normalized(o.y), radius: normalized(o.radius) });
  }
  const generated = await upload(ref.id, "generated", "generated.png");
  must(await setGeneratedImage(db, ref.id, { key: generated, width: spec.image.width, height: spec.image.height }, proposals), "generated");
  const toConfirm = confirmAll ? proposals : proposals.slice(0, -1);
  for (const p of toConfirm) must(await confirmObject(db, master, p.objectId), "confirm");
  return ref;
}

async function schedule(db: Database, master: User, ref: Ref, window: Window, publish: boolean): Promise<void> {
  if (!window) return;
  const now = new Date(window.startsAt.getTime() - HOUR); // validation needs starts_at ≥ now
  must(await setWindow(db, master, ref.id, window, now), "window");
  if (publish) must(await publishGame(db, master, ref.id, now), "publish");
}

/** Three players submit inside the window: all found, two found, none found. */
async function playFinished(db: Database, ref: Ref, players: User[], window: NonNullable<Window>): Promise<void> {
  const centre = (i: number): NormalizedPoint => ({ x: normalized(spec.objects[i].x), y: normalized(spec.objects[i].y) });
  const miss: NormalizedPoint = { x: normalized(0.05), y: normalized(0.95) };
  const guesses: NormalizedPoint[][] = [
    [centre(0), centre(1), centre(2)],
    [centre(0), centre(1), miss],
    [miss, miss, miss],
  ];
  for (const [i, player] of players.entries()) {
    const t0 = new Date(window.startsAt.getTime() + (i + 1) * 10 * 60_000);
    must(await startAttempt(db, player, ref.publicId, t0), "start");
    must(await submitAttempt(db, player, ref.publicId, guesses[i], new Date(t0.getTime() + 20_000 + i * 15_000)), "submit");
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);
  const json = process.argv.includes("--json");
  const log = (s: string) => { if (!json) console.log(s); else console.error(s); };

  const masterId = process.env.SEED_MASTER_ID ?? "seed-master";
  const master = await ensureUser(db, masterId, "Seed Master");
  const opponent = await ensureUser(db, "seed-opponent", "Seed Opponent");
  const players = await Promise.all([1, 2, 3].map((n) => ensureUser(db, `seed-player-${n}`, `Player ${n}`)));

  const deleted = await db.delete(games).where(like(games.title, `${PREFIX}%`)).returning({ id: games.id });
  log(`removed ${deleted.length} previous seed game(s)`);

  const now = Date.now();
  const windows = {
    draft: { startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY) },
    scheduled: { startsAt: new Date(now + DAY), endsAt: new Date(now + 2 * DAY) },
    active: { startsAt: new Date(now - HOUR), endsAt: new Date(now + DAY) },
    finished: { startsAt: new Date(now - 2 * DAY), endsAt: new Date(now - HOUR) },
  } as const;

  const mine = {} as Record<keyof typeof windows, Ref>;
  for (const state of ["draft", "scheduled", "active", "finished"] as const) {
    const ref = await author(db, master, `${PREFIX}${state}`, state !== "draft");
    await schedule(db, master, ref, windows[state], state !== "draft");
    if (state === "finished") await playFinished(db, ref, players, windows.finished);
    mine[state] = ref;
    log(`${state.padEnd(9)} /g/${ref.publicId}  (/games/${ref.id})`);
  }

  const theirs = {} as Record<"scheduled" | "active" | "finished", Ref>;
  for (const state of ["scheduled", "active", "finished"] as const) {
    const ref = await author(db, opponent, `${PREFIX}${state} (opponent)`, true);
    await schedule(db, opponent, ref, windows[state], true);
    if (state === "finished") await playFinished(db, ref, players, windows.finished);
    theirs[state] = ref;
    log(`${state.padEnd(9)} /g/${ref.publicId}  (opponent's)`);
  }

  if (json) console.log(JSON.stringify({ masterId, mine, theirs }));
  await db.$client.end();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Run the seed against the dev branch**

Run: `npm run seed`
Expected: prints 7 lines with `/g/<publicId>` URLs, exit 0. Then `npm run seed -- --json | tail -1 | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(Object.keys(j.mine), Object.keys(j.theirs))'` prints `[ 'draft', 'scheduled', 'active', 'finished' ] [ 'scheduled', 'active', 'finished' ]`. Open `http://localhost:3000/games` while signed in (with `SEED_MASTER_ID` unset the games belong to `seed-master`, so check via `npm run db:studio` or trust the log lines).

- [ ] **Step 7: Verify and commit**

Run: `npm run verify && npx knip`
Expected: green; knip reports no unused exports/dependencies.

```bash
git add src/db/seed src/lib/storage.ts package.json package-lock.json knip.json .gitignore .env.example
git commit -m "feat(seed): demo games in every lifecycle state with committed fixtures

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 3: `MarkerCanvas` and `TrashZone`

**Files:**
- Create: `src/components/canvas/marker-canvas.tsx`
- Create: `src/components/canvas/trash-zone.tsx`

**Interfaces:**
- Consumes: Task 1 geometry; `GameImage`, `Normalized`, `NormalizedPoint` from `@/lib/types`.
- Produces (used by Tasks 5, 6):
  ```ts
  export type CanvasMode = "play" | "author" | "reveal";
  export type CanvasMarker = { id: string; x: Normalized; y: Normalized; radius?: Normalized; label?: string; confirmed?: boolean };
  export type MarkerCanvasProps = {
    image: GameImage; mode: CanvasMode; markers: readonly CanvasMarker[];
    selectedId?: string | null; canAdd?: boolean;
    onAdd?: (point: NormalizedPoint) => void;
    onMove?: (id: string, point: NormalizedPoint) => void;
    onResize?: (id: string, radius: Normalized) => void;
    onRemove?: (id: string) => void;
    onSelect?: (id: string) => void;
    trashRef?: RefObject<HTMLElement | null>;
  };
  export function MarkerCanvas(props: MarkerCanvasProps): JSX.Element;
  export function TrashZone({ ref, active }: { ref: Ref<HTMLDivElement>; active: boolean }): JSX.Element;
  ```
  DOM contract for E2E: root `data-testid="marker-canvas"` `data-mode`; each marker `<g data-testid="marker" data-marker-id tabindex>`; author handle `data-testid="radius-handle"`; trash `data-testid="trash-zone"`.

No unit test: the component is a thin event→callback shell over Task 1's pure functions and is exercised by Task 7's E2E.

- [ ] **Step 1: Write `MarkerCanvas`**

`src/components/canvas/marker-canvas.tsx`:

```tsx
"use client";
/**
 * One canvas, three modes (SPEC §6.3). An SVG overlay in image-pixel space stacked over
 * the <img>; the browser scales both together, so a marker drawn at (x·W, y·H) sits on
 * the same pixel the scorer tests. Controlled: the parent owns marker state and receives
 * one callback per completed gesture (pointer-up), never per pointer-move.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { GameImage, Normalized, NormalizedPoint } from "@/lib/types";
import { nudge, radiusFromHandle, radiusPx, toNormalized, toPixel, type Rect } from "./geometry";

export type CanvasMode = "play" | "author" | "reveal";

export type CanvasMarker = {
  readonly id: string;
  readonly x: Normalized;
  readonly y: Normalized;
  /** Present in author/reveal (an object's hit circle); absent in play (an unlabelled guess). */
  readonly radius?: Normalized;
  readonly label?: string;
  readonly confirmed?: boolean;
};

export type MarkerCanvasProps = {
  readonly image: GameImage;
  readonly mode: CanvasMode;
  readonly markers: readonly CanvasMarker[];
  readonly selectedId?: string | null;
  /** play: fewer than N markers placed; author: an unplaced object is selected. */
  readonly canAdd?: boolean;
  readonly onAdd?: (point: NormalizedPoint) => void;
  readonly onMove?: (id: string, point: NormalizedPoint) => void;
  readonly onResize?: (id: string, radius: Normalized) => void;
  readonly onRemove?: (id: string) => void;
  readonly onSelect?: (id: string) => void;
  /** play: releasing a marker over this element removes it. */
  readonly trashRef?: RefObject<HTMLElement | null>;
};

type Drag = { readonly id: string; readonly kind: "center" | "handle"; readonly point: NormalizedPoint };

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const;
const NO_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

function over(el: HTMLElement | null | undefined, clientX: number, clientY: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

export function MarkerCanvas(props: MarkerCanvasProps) {
  const { image, mode, markers, selectedId = null, canAdd = false, trashRef } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const readOnly = mode === "reveal";
  const dotR = image.width * 0.015;
  const stroke = Math.max(2, image.width * 0.003);
  const rect = (): Rect => svgRef.current?.getBoundingClientRect() ?? NO_RECT;
  const find = (id: string) => markers.find((m) => m.id === id);

  function onBackgroundPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (readOnly || !canAdd || e.target !== e.currentTarget) return;
    const p = toNormalized(e.clientX, e.clientY, rect(), { clamp: false });
    if (p) props.onAdd?.(p);
  }

  function startDrag(e: PointerEvent<SVGElement>, id: string, kind: Drag["kind"]) {
    if (readOnly) return;
    e.stopPropagation();
    const m = find(id);
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    props.onSelect?.(id);
    const start = kind === "center" ? { x: m.x, y: m.y } : (toNormalized(e.clientX, e.clientY, rect(), { clamp: true }) ?? { x: m.x, y: m.y });
    setDrag({ id, kind, point: start });
  }

  function onPointerMove(e: PointerEvent<SVGElement>) {
    if (!drag) return;
    const p = toNormalized(e.clientX, e.clientY, rect(), { clamp: true });
    if (!p) return;
    setDrag({ ...drag, point: p });
    if (mode === "play") setOverTrash(over(trashRef?.current, e.clientX, e.clientY));
  }

  function endDrag(e: PointerEvent<SVGElement>) {
    if (!drag) return;
    const m = find(drag.id);
    if (m) {
      if (drag.kind === "handle") props.onResize?.(m.id, radiusFromHandle({ x: m.x, y: m.y }, drag.point, image));
      else if (mode === "play" && over(trashRef?.current, e.clientX, e.clientY)) props.onRemove?.(m.id);
      else props.onMove?.(m.id, drag.point);
    }
    setDrag(null);
    setOverTrash(false);
  }

  function onKeyDown(e: KeyboardEvent<SVGGElement>, m: CanvasMarker) {
    if (readOnly) return;
    const d = ARROWS[e.key as keyof typeof ARROWS];
    if (d) {
      e.preventDefault();
      props.onMove?.(m.id, nudge({ x: m.x, y: m.y }, d[0], d[1]));
      return;
    }
    if (mode === "play" && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      props.onRemove?.(m.id);
    }
  }

  return (
    <div className="relative w-full select-none" data-testid="marker-canvas" data-mode={mode}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} width={image.width} height={image.height} alt="" draggable={false} className="block h-auto w-full" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
        role="application"
        aria-label={mode === "play" ? "Place your markers" : "Object positions"}
        onPointerDown={onBackgroundPointerDown}
      >
        {markers.map((m) => {
          const dragging = drag?.id === m.id ? drag : null;
          const center = dragging?.kind === "center" ? dragging.point : { x: m.x, y: m.y };
          const radius = m.radius === undefined ? null : dragging?.kind === "handle" ? radiusFromHandle(center, dragging.point, image) : m.radius;
          const c = toPixel(center, image);
          const rPx = radius === null ? 0 : radiusPx(radius, image);
          const selected = selectedId === m.id;
          const unconfirmed = m.confirmed === false;
          return (
            <g
              key={m.id}
              data-testid="marker"
              data-marker-id={m.id}
              data-selected={selected || undefined}
              data-over-trash={(dragging !== null && overTrash) || undefined}
              tabIndex={readOnly ? -1 : 0}
              className="outline-none focus-visible:[&>circle:last-of-type]:stroke-yellow-400"
              style={{ cursor: readOnly ? "default" : dragging ? "grabbing" : "grab" }}
              onKeyDown={(e) => onKeyDown(e, m)}
              onPointerDown={(e) => startDrag(e, m.id, "center")}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {radius !== null && (
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={rPx}
                  fill={selected ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.001)"}
                  stroke={unconfirmed ? "#f59e0b" : "#22c55e"}
                  strokeWidth={stroke}
                  strokeDasharray={unconfirmed ? `${stroke * 3} ${stroke * 2}` : undefined}
                />
              )}
              {m.label && (
                <text
                  x={c.x}
                  y={c.y - (radius === null ? dotR : rPx) - stroke * 2}
                  textAnchor="middle"
                  fontSize={image.width * 0.022}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={stroke / 2}
                  paintOrder="stroke"
                >
                  {m.label}
                </text>
              )}
              <circle cx={c.x} cy={c.y} r={dotR} fill={mode === "play" ? "rgba(239,68,68,0.9)" : "rgba(255,255,255,0.95)"} stroke="#111" strokeWidth={stroke} />
              {mode === "author" && radius !== null && (
                <circle
                  data-testid="radius-handle"
                  cx={c.x + rPx}
                  cy={c.y}
                  r={dotR * 0.8}
                  fill="#fff"
                  stroke="#111"
                  strokeWidth={stroke}
                  style={{ cursor: "ew-resize" }}
                  onPointerDown={(e) => startDrag(e, m.id, "handle")}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

Notes for the implementer: pointer capture is set on the element that received pointer-down (`<g>` or the handle), so subsequent move/up events dispatch there and bubble to the `<g>` handlers. `e.target !== e.currentTarget` on the SVG means a click landed on a marker, not the background. `fill="rgba(0,0,0,0.001)"` keeps the hit circle clickable in author mode so the master can grab anywhere inside it.

- [ ] **Step 2: Write `TrashZone`**

`src/components/canvas/trash-zone.tsx`:

```tsx
"use client";
import type { Ref } from "react";

/** Drop target for play mode: `MarkerCanvas` tests the pointer against this element on release. */
export function TrashZone({ ref, active }: { ref: Ref<HTMLDivElement>; active: boolean }) {
  return (
    <div
      ref={ref}
      data-testid="trash-zone"
      aria-label="Drag a marker here to remove it"
      className={`flex h-16 items-center justify-center rounded border-2 border-dashed text-sm ${active ? "border-red-500 bg-red-50 text-red-700" : "border-neutral-300 text-neutral-500"}`}
    >
      🗑 Drag a marker here to remove it
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: typecheck + lint green (React 19 accepts `ref` as a prop; if `@types/react` rejects it, use `forwardRef` and note it in the report). Existing tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas
git commit -m "feat(canvas): MarkerCanvas with play, author, and reveal modes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 4: `Timer`, `ObjectRail`, `Leaderboard`

**Files:**
- Create: `src/components/canvas/timer.tsx`, `src/components/canvas/object-rail.tsx`, `src/components/canvas/leaderboard.tsx`

**Interfaces:**
- Consumes: `formatElapsed` (Task 1); `ObjectThumbnail`, `LeaderboardEntry` from `@/lib/types`.
- Produces (Task 5): `Timer({ startedAtMs, serverNowMs })`, `ObjectRail({ objects })`, `Leaderboard({ entries })`. DOM: `data-testid="timer"`, `data-testid="object-rail"` with one `<li>` per object, `data-testid="leaderboard"` with `<tr data-viewer="true">` on the viewer's row.

- [ ] **Step 1: Timer**

`src/components/canvas/timer.tsx`:

```tsx
"use client";
/**
 * Display-only clock. `startedAt` and `serverNow` both come from the server; the device
 * clock is used only to advance the display between renders, offset-corrected so a
 * skewed client shows the same elapsed time the server will record (invariant 5).
 */
import { useState, useSyncExternalStore } from "react";
import { formatElapsed } from "./format";

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 100);
  return () => clearInterval(id);
}

export function Timer({ startedAtMs, serverNowMs }: { startedAtMs: number; serverNowMs: number }) {
  const [offset] = useState(() => serverNowMs - Date.now());
  const now = useSyncExternalStore(
    subscribe,
    () => Date.now() + offset,
    () => serverNowMs, // server snapshot: identical markup on both sides of hydration
  );
  return (
    <span data-testid="timer" className="font-mono text-2xl tabular-nums" aria-live="off">
      {formatElapsed(now - startedAtMs)}
    </span>
  );
}
```

- [ ] **Step 2: ObjectRail**

`src/components/canvas/object-rail.tsx`:

```tsx
import type { ObjectThumbnail } from "@/lib/types";

/** SPEC §3.3.4: the thumbnails of all N objects stay visible throughout play. */
export function ObjectRail({ objects }: { objects: readonly ObjectThumbnail[] }) {
  return (
    <ul data-testid="object-rail" className="flex flex-wrap gap-3">
      {objects.map((o) => (
        <li key={o.id} className="flex w-24 flex-col items-center gap-1 text-center text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={o.sourceImageUrl} alt={o.label} className="h-20 w-20 rounded border object-contain" />
          <span>{o.label}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Leaderboard**

`src/components/canvas/leaderboard.tsx`:

```tsx
import type { LeaderboardEntry } from "@/lib/types";
import { formatElapsed } from "./format";

/** Names, scores, times — never coordinates (SPEC §3.4). Ranked by the server. */
export function Leaderboard({ entries }: { entries: readonly LeaderboardEntry[] }) {
  if (entries.length === 0) return <p className="text-neutral-500">No submissions yet.</p>;
  return (
    <table data-testid="leaderboard" className="w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="py-1 pr-3">#</th>
          <th className="py-1 pr-3">Player</th>
          <th className="py-1 pr-3">Found</th>
          <th className="py-1">Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.rank}-${e.userName}`} data-viewer={e.isViewer || undefined} className={e.isViewer ? "bg-yellow-50 font-medium" : undefined}>
            <td className="py-1 pr-3">{e.rank}</td>
            <td className="py-1 pr-3">{e.userName}</td>
            <td className="py-1 pr-3">{e.foundCount}</td>
            <td className="py-1 font-mono tabular-nums">{formatElapsed(e.elapsedMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run verify`

```bash
git add src/components/canvas
git commit -m "feat(canvas): timer, object rail, and leaderboard components

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 5: `/g/[publicId]` play surface

**Files:**
- Create: `src/app/g/[publicId]/page.tsx`, `start-screen.tsx`, `play-screen.tsx`, `result-screen.tsx`, `finished-screen.tsx`

**Interfaces:**
- Consumes: `loadGameForViewer` (`@/lib/games/queries`), `startAttemptAction`, `submitAttemptAction`, `getPlayerStateAction`, `getLeaderboardAction` (`@/lib/games/actions`), `getCurrentUser`, `getDb`, Tasks 1/3/4.
- Produces: the route. DOM contract for Task 7: Start button `role=button name="Start"`; warning text contains "does not pause"; submit `data-testid="submit"`; confirm dialog `role="dialog"` with `data-testid="confirm-submit"`; result `data-testid="result"` text `Found {n} of {N}`; marker count `data-testid="marker-count"` text `{k} / {N}`.

- [ ] **Step 1: StartScreen — props cannot carry the image**

`src/app/g/[publicId]/start-screen.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectRail } from "@/components/canvas/object-rail";
import { startAttemptAction } from "@/lib/games/actions";
import type { ObjectThumbnail } from "@/lib/types";

/**
 * Rendered before Start. By construction this tree never receives `image` — the prop type
 * has no such field — so the generated image cannot reach the HTML until the server has
 * written `started_at` (handoff "image before Start"). Task 7 asserts it on the wire.
 */
export function StartScreen({
  publicId,
  title,
  objects,
  signedIn,
  error,
}: {
  publicId: string;
  title: string;
  objects: readonly ObjectThumbnail[];
  signedIn: boolean;
  error?: string;
}) {
  async function start() {
    "use server";
    const r = await startAttemptAction(publicId);
    redirect(`/g/${publicId}${r.ok ? "" : `?error=${encodeURIComponent(r.message)}`}`);
  }
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      <section>
        <h2 className="mb-2 font-medium">Find these {objects.length} objects</h2>
        <ObjectRail objects={objects} />
      </section>
      <section className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Before you start</p>
        <ul className="mt-1 list-disc pl-5">
          <li>The timer starts the moment you press Start and does not pause — not if you close the tab, not if you walk away.</li>
          <li>You get one submission. An unsubmitted attempt never reaches the leaderboard.</li>
        </ul>
      </section>
      {signedIn ? (
        <form action={start}>
          <button className="rounded bg-black px-5 py-3 text-lg text-white">Start</button>
        </form>
      ) : (
        <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/g/${publicId}`)}`} className="w-fit rounded bg-black px-5 py-3 text-lg text-white">
          Sign in to start
        </Link>
      )}
    </main>
  );
}
```

- [ ] **Step 2: PlayScreen**

`src/app/g/[publicId]/play-screen.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useReducer, useRef, useState, useTransition } from "react";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import { canSubmit, EMPTY_MARKERS, markerReducer, type MarkerAction, type MarkerState } from "@/components/canvas/marker-state";
import { ObjectRail } from "@/components/canvas/object-rail";
import { Timer } from "@/components/canvas/timer";
import { TrashZone } from "@/components/canvas/trash-zone";
import { submitAttemptAction } from "@/lib/games/actions";
import type { GameImage, ObjectThumbnail } from "@/lib/types";

export function PlayScreen({
  publicId,
  title,
  image,
  objects,
  startedAtMs,
  serverNowMs,
}: {
  publicId: string;
  title: string;
  image: GameImage;
  objects: readonly ObjectThumbnail[];
  startedAtMs: number;
  serverNowMs: number;
}) {
  const total = objects.length;
  const router = useRouter();
  const trashRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [state, dispatch] = useReducer((s: MarkerState, a: MarkerAction) => markerReducer(s, a, total), EMPTY_MARKERS);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = canSubmit(state, total);

  function submit() {
    start(async () => {
      setError(null);
      const r = await submitAttemptAction(publicId, state.markers.map(({ x, y }) => ({ x, y })));
      if (r.ok || r.error === "ALREADY_SUBMITTED" || r.error === "NOT_ACTIVE") {
        router.refresh(); // the server decides what this player sees next
        return;
      }
      setConfirming(false);
      setError(r.message);
    });
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Timer startedAtMs={startedAtMs} serverNowMs={serverNowMs} />
      </header>
      <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
        <MarkerCanvas
          image={image}
          mode="play"
          markers={state.markers}
          selectedId={state.selected}
          canAdd={state.markers.length < total}
          trashRef={trashRef}
          onAdd={(point) => dispatch({ type: "add", id: `m${nextId.current++}`, point })}
          onMove={(id, point) => dispatch({ type: "move", id, point })}
          onRemove={(id) => dispatch({ type: "remove", id })}
          onSelect={(id) => dispatch({ type: "select", id })}
        />
        <aside className="flex flex-col gap-3">
          <ObjectRail objects={objects} />
        </aside>
      </div>
      <TrashZone ref={trashRef} active={state.selected !== null} />
      <footer className="flex items-center justify-between">
        <span data-testid="marker-count" className="text-sm text-neutral-600">
          {state.markers.length} / {total} markers
        </span>
        <button data-testid="submit" disabled={!ready || pending} onClick={() => setConfirming(true)} className="rounded bg-black px-4 py-2 text-white disabled:opacity-40">
          Submit
        </button>
      </footer>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      {confirming && (
        <div role="dialog" aria-modal="true" data-testid="confirm-submit" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-w-sm flex-col gap-4 rounded bg-white p-6 text-black">
            <p className="font-medium">Submit your {total} markers?</p>
            <p className="text-sm">You get one submission for this game. After this you cannot play again.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={pending} className="rounded border px-3 py-2">
                Keep looking
              </button>
              <button data-testid="confirm-submit-yes" onClick={submit} disabled={pending} className="rounded bg-black px-3 py-2 text-white">
                {pending ? "Submitting…" : "Submit — I understand"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: ResultScreen and FinishedScreen**

`src/app/g/[publicId]/result-screen.tsx`:

```tsx
import { formatElapsed } from "@/components/canvas/format";
import { Leaderboard } from "@/components/canvas/leaderboard";
import type { AttemptResult, GameImage, LeaderboardEntry } from "@/lib/types";

/** After submission. The image is shown bare: no markers, no hint of where the misses were (SPEC §3.3.7). */
export function ResultScreen({
  title,
  image,
  total,
  result,
  leaderboard,
}: {
  title: string;
  image: GameImage;
  total: number;
  result: AttemptResult;
  leaderboard: readonly LeaderboardEntry[];
}) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p data-testid="result" className="text-lg">
        Found {result.foundCount} of {total} in <span className="font-mono">{formatElapsed(result.elapsedMs)}</span>
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} width={image.width} height={image.height} alt="" className="w-full rounded" />
      <section>
        <h2 className="mb-2 font-medium">Leaderboard</h2>
        <Leaderboard entries={leaderboard} />
      </section>
    </main>
  );
}
```

`src/app/g/[publicId]/finished-screen.tsx`:

```tsx
import { Leaderboard } from "@/components/canvas/leaderboard";
import { MarkerCanvas } from "@/components/canvas/marker-canvas";
import type { FinishedGameView, LeaderboardEntry } from "@/lib/types";

/** After ends_at: true positions annotated, final board (SPEC §3.3.8). */
export function FinishedScreen({ view, leaderboard }: { view: FinishedGameView; leaderboard: readonly LeaderboardEntry[] }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{view.title}</h1>
      <p className="text-neutral-600">This game has ended. Here is where everything was.</p>
      <MarkerCanvas image={view.image} mode="reveal" markers={view.objects.map((o) => ({ id: o.id, x: o.x, y: o.y, radius: o.radius, label: o.label }))} />
      <section>
        <h2 className="mb-2 font-medium">Final leaderboard</h2>
        <Leaderboard entries={leaderboard} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: The page**

`src/app/g/[publicId]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getLeaderboardAction, getPlayerStateAction } from "@/lib/games/actions";
import { loadGameForViewer } from "@/lib/games/queries";
import { FinishedScreen } from "./finished-screen";
import { PlayScreen } from "./play-screen";
import { ResultScreen } from "./result-screen";
import { StartScreen } from "./start-screen";

export const dynamic = "force-dynamic";

/**
 * SPEC §3.3. `loadGameForViewer` already returns null for anything a player may not see
 * (draft/scheduled → 404) and a master view for the owner. Which screen a player gets is
 * decided here from server state only; the client never tells us where it is.
 */
export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ publicId }, { error }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  const now = new Date();
  const view = await loadGameForViewer(getDb(), publicId, user?.id ?? null, now);
  if (!view) notFound();
  if (view.viewer === "master") redirect(`/games/${view.id}`); // masters review, they do not play (SPEC §11)

  if (view.status === "finished") {
    const lb = await getLeaderboardAction(publicId);
    return <FinishedScreen view={view} leaderboard={lb.ok ? lb.data : []} />;
  }

  const state = user ? await getPlayerStateAction(publicId) : null;
  const attempt = state?.ok ? state.data : { kind: "not_started" as const };
  const common = { publicId, title: view.title, objects: view.objects };

  switch (attempt.kind) {
    case "not_started":
      return <StartScreen {...common} signedIn={user !== null} error={error} />;
    case "in_progress":
      return <PlayScreen {...common} image={view.image} startedAtMs={attempt.startedAt.getTime()} serverNowMs={now.getTime()} />;
    case "submitted": {
      const lb = await getLeaderboardAction(publicId);
      return <ResultScreen title={view.title} image={view.image} total={view.objects.length} result={attempt.result} leaderboard={lb.ok ? lb.data : []} />;
    }
  }
}
```

- [ ] **Step 5: Manual smoke against the seed**

Run `npm run seed` (if not already), `npm run dev`, sign in, open the opponent's active game URL from the seed log: Start screen (no image), Start → canvas + timer + rail, place 3 markers, drag one to the trash, re-add, Submit → dialog → result + leaderboard. Reload: result persists. Open the opponent's finished game: reveal circles + board. Open the opponent's scheduled game: 404. Open one of "mine": redirected to `/games/<id>`.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`

```bash
git add src/app/g
git commit -m "feat(play): /g/[publicId] start, play, result, and finished screens

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 6: Authoring integration — drag to position, confirm

**Files:**
- Create: `src/app/(master)/games/[id]/author-canvas.tsx`
- Modify: `src/app/(master)/games/[id]/page.tsx` (add a Positions section)

**Interfaces:**
- Consumes: `MarkerCanvas` (Task 3), `DEFAULT_RADIUS` (Task 1), `updateObjectAction` (Phase 1: any position write resets `confirmed`), `ObjectForMaster`, `GameImage`.
- Produces: DOM for Task 7: `data-testid="object-chip"` buttons (one per object, `aria-pressed` when selected); the canvas as in Task 3.

- [ ] **Step 1: AuthorCanvas**

`src/app/(master)/games/[id]/author-canvas.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DEFAULT_RADIUS } from "@/components/canvas/geometry";
import { MarkerCanvas, type CanvasMarker } from "@/components/canvas/marker-canvas";
import { updateObjectAction } from "@/lib/games/actions";
import { normalized, type GameImage, type Normalized, type ObjectForMaster } from "@/lib/types";

/**
 * SPEC §3.1.6 / §5.4: the master adjusts proposals by dragging and confirms. Every gesture
 * ends in one `updateObjectAction` call, which resets `confirmed` (Phase 1 rule), so the
 * confirmed badge always reflects the geometry on screen.
 */
export function AuthorCanvas({ gameId, image, objects, editable }: { gameId: string; image: GameImage; objects: readonly ObjectForMaster[]; editable: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const placed: CanvasMarker[] = objects.flatMap((o) =>
    o.x === null || o.y === null || o.radius === null ? [] : [{ id: o.id, x: o.x, y: o.y, radius: o.radius, label: o.label, confirmed: o.confirmed }],
  );
  const selectedUnplaced = objects.find((o) => o.id === selectedId && o.x === null) ?? null;

  function save(objectId: string, input: { x: Normalized; y: Normalized; radius: Normalized }) {
    start(async () => {
      setError(null);
      const r = await updateObjectAction(gameId, objectId, input);
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  }
  const byId = (id: string) => objects.find((o) => o.id === id);

  return (
    <div className="flex flex-col gap-3">
      <MarkerCanvas
        image={image}
        mode={editable ? "author" : "reveal"}
        markers={placed}
        selectedId={selectedId}
        canAdd={editable && selectedUnplaced !== null}
        onSelect={setSelectedId}
        onAdd={(p) => selectedUnplaced && save(selectedUnplaced.id, { x: p.x, y: p.y, radius: normalized(DEFAULT_RADIUS) })}
        onMove={(id, p) => {
          const o = byId(id);
          if (o?.radius != null) save(id, { x: p.x, y: p.y, radius: o.radius });
        }}
        onResize={(id, radius) => {
          const o = byId(id);
          if (o?.x != null && o.y != null) save(id, { x: o.x, y: o.y, radius });
        }}
      />
      {editable && (
        <div className="flex flex-wrap gap-2">
          {objects.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid="object-chip"
              aria-pressed={selectedId === o.id}
              onClick={() => setSelectedId(o.id)}
              className="rounded border px-2 py-1 text-sm aria-pressed:bg-black aria-pressed:text-white"
            >
              {o.label}
              {o.x === null ? " — select, then click the image to place" : o.confirmed ? " ✓" : " (unconfirmed)"}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-500">Drag a circle to move it, drag its handle to resize. Any change needs a fresh Confirm.</p>
      {pending && <p className="text-xs text-neutral-500">Saving…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the edit page**

In `src/app/(master)/games/[id]/page.tsx` add `import { AuthorCanvas } from "./author-canvas";` and insert this section between the Background section and the Objects section:

```tsx
      {game.image && (
        <section>
          <h2 className="mb-2 font-medium">Positions</h2>
          <AuthorCanvas gameId={id} image={game.image} objects={game.objects} editable={editable} />
        </section>
      )}
```

- [ ] **Step 3: Manual check**

Run the seed with your own Clerk id (`SEED_MASTER_ID=<id> npm run seed`; your id is in the Clerk dashboard, or `select id from users` in `npm run db:studio`). Open `/games/<draft id>`: three circles, one dashed (unconfirmed). Drag a confirmed one → after refresh it shows dashed and the row badge says unconfirmed. Resize via handle. Confirm all three via the rows, Publish → scheduled, canvas turns read-only.

- [ ] **Step 4: Verify and commit**

Run: `npm run verify && npm run lint:dup`
Expected: green; duplication 0% (if jscpd flags the two `save` call sites, keep them — they are below its minimum token window; if it flags something larger, extract before committing).

```bash
git add "src/app/(master)/games/[id]"
git commit -m "feat(master): drag-to-position authoring canvas on the edit page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 7: Playwright harness

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/seed-data.ts`, `e2e/helpers.ts`, `e2e/play.spec.ts`, `e2e/lifecycle.spec.ts`, `e2e/author.spec.ts`
- Modify: `package.json` (`test:e2e` script; devDependencies `@clerk/testing`, `@clerk/backend`), `knip.json`

**Interfaces:**
- Consumes: Task 2 seed `--json` output; DOM contracts from Tasks 3–6.
- Produces: `npm run test:e2e` (self-provisioning: ensures the Clerk test user, seeds, signs in, runs); `e2e/.auth/seed.json` (git-ignored).

Auth model: `@clerk/testing`'s `clerk.signIn({ page, emailAddress })` mints a **sign-in token** through the Backend API (`CLERK_SECRET_KEY`) and signs in with the ticket strategy — no password, no OAuth, no dashboard change; works on a Google-only instance.

- [ ] **Step 1: Dependencies and scripts**

```bash
npm install -D @clerk/testing @clerk/backend
```

`package.json` scripts: add `"test:e2e": "playwright test"`.

`knip.json`: add `"e2e/**/*.ts"` and `"playwright.config.ts"` to both `entry` and `project`.

- [ ] **Step 2: Config**

`playwright.config.ts`:

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same .env.local resolution as Next; in CI the job's env provides everything.
loadEnvConfig(process.cwd());

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // specs share the seeded games
  retries: 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    storageState: "e2e/.auth/user.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: CI ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !CI,
    timeout: 240_000,
  },
});
```

Playwright starts `webServer` before `globalSetup`, so the sign-in step below can navigate to the app.

- [ ] **Step 3: Global setup, seed data, helpers**

`e2e/global-setup.ts`:

```ts
/**
 * 1. Resolve the Clerk test user (E2E_CLERK_USER_ID, else find-or-create e2e@spotted.test).
 * 2. Seed the database with that user as master → e2e/.auth/seed.json.
 * 3. Sign in through a Clerk sign-in token → e2e/.auth/user.json (storage state).
 */
import { createClerkClient } from "@clerk/backend";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { chromium, type FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const EMAIL = "e2e@spotted.test";

async function resolveUser(): Promise<{ id: string; email: string }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const client = createClerkClient({ secretKey });
  const explicit = process.env.E2E_CLERK_USER_ID;
  if (explicit) {
    const u = await client.users.getUser(explicit);
    const email = u.primaryEmailAddress?.emailAddress;
    if (!email) throw new Error(`Clerk user ${explicit} has no primary email`);
    return { id: u.id, email };
  }
  const found = (await client.users.getUserList({ emailAddress: [EMAIL] })).data[0];
  if (found) return { id: found.id, email: EMAIL };
  const created = await client.users.createUser({ emailAddress: [EMAIL], firstName: "E2E", lastName: "Player", skipPasswordRequirement: true });
  return { id: created.id, email: EMAIL };
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await clerkSetup();
  const user = await resolveUser();

  const out = execFileSync("npm", ["run", "-s", "seed", "--", "--json"], {
    env: { ...process.env, SEED_MASTER_ID: user.id },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lastLine = out.trim().split("\n").at(-1) ?? "";
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync("e2e/.auth/seed.json", JSON.stringify({ ...JSON.parse(lastLine), user }));

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/games"); // a protected route: proves the session is live
  await page.waitForURL("**/games");
  await page.context().storageState({ path: "e2e/.auth/user.json" });
  await browser.close();
}
```

`e2e/seed-data.ts`:

```ts
import { readFileSync } from "node:fs";

type Ref = { id: string; publicId: string };
export type SeedData = {
  masterId: string;
  mine: Record<"draft" | "scheduled" | "active" | "finished", Ref>;
  theirs: Record<"scheduled" | "active" | "finished", Ref>;
  user: { id: string; email: string };
};

/** Written by global-setup; one seed per run so every spec plays fresh games. */
export function seed(): SeedData {
  return JSON.parse(readFileSync("e2e/.auth/seed.json", "utf8")) as SeedData;
}
```

`e2e/helpers.ts`:

```ts
import type { Locator, Page } from "@playwright/test";

export type Point = { x: number; y: number };

export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/** Fractional position inside an element's box. */
export async function within(locator: Locator, fx: number, fy: number): Promise<Point> {
  const b = await boxOf(locator);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

export async function centerOf(locator: Locator): Promise<Point> {
  return within(locator, 0.5, 0.5);
}

/** Pointer drag with intermediate moves so pointer capture and hit-testing behave like a real hand. */
export async function drag(page: Page, from: Locator, to: Point): Promise<void> {
  const start = await centerOf(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}
```

- [ ] **Step 4: Play spec**

`e2e/play.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { centerOf, drag, within } from "./helpers";
import { seed } from "./seed-data";

const GENERATED = /\/generated\//;
const TEXTUAL = /text\/html|text\/x-component|application\/json|javascript/;

test("plays a seeded game to a scored submission", async ({ page }) => {
  const { theirs } = seed();
  const url = `/g/${theirs.active.publicId}`;

  // Invariant (handoff "image before Start"): nothing the browser receives before Start
  // references the generated image. Checked on the wire, not in the DOM.
  let started = false;
  const checks: Promise<string | null>[] = [];
  page.on("response", (res) => {
    if (started || !TEXTUAL.test(res.headers()["content-type"] ?? "")) return;
    checks.push(res.text().then((body) => (GENERATED.test(body) ? res.url() : null)).catch(() => null));
  });

  await page.goto(url);
  const startButton = page.getByRole("button", { name: "Start" });
  await expect(startButton).toBeVisible();
  await expect(page.getByText(/does not pause/)).toBeVisible();
  await expect(page.getByTestId("object-rail").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("marker-canvas")).toHaveCount(0);
  expect((await Promise.all(checks)).filter(Boolean), "generated image reached the client before Start").toEqual([]);

  started = true;
  await startButton.click();
  const canvas = page.getByTestId("marker-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("timer")).toBeVisible();
  const markers = page.getByTestId("marker");
  const submit = page.getByTestId("submit");

  // Add up to N; the N+1th click is ignored.
  for (const [fx, fy] of [[0.25, 0.3], [0.62, 0.55]]) {
    const p = await within(canvas, fx, fy);
    await page.mouse.click(p.x, p.y);
  }
  await expect(markers).toHaveCount(2);
  await expect(page.getByTestId("marker-count")).toHaveText("2 / 3 markers");
  await expect(submit).toBeDisabled();
  const wrong = await within(canvas, 0.1, 0.9);
  await page.mouse.click(wrong.x, wrong.y);
  await expect(markers).toHaveCount(3);
  await expect(submit).toBeEnabled();
  const extra = await within(canvas, 0.5, 0.5);
  await page.mouse.click(extra.x, extra.y);
  await expect(markers).toHaveCount(3);

  // Drag the wrong one onto the third object; drag the first into the trash; re-add it.
  await drag(page, markers.nth(2), await within(canvas, 0.8, 0.2));
  await drag(page, markers.nth(0), await centerOf(page.getByTestId("trash-zone")));
  await expect(markers).toHaveCount(2);
  await expect(submit).toBeDisabled();
  const first = await within(canvas, 0.25, 0.3);
  await page.mouse.click(first.x, first.y);
  await expect(markers).toHaveCount(3);

  // Submit is confirmed, and the response carries no coordinates.
  const submitResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(url));
  await submit.click();
  await expect(page.getByTestId("confirm-submit")).toBeVisible();
  await page.getByTestId("confirm-submit-yes").click();
  const body = await (await submitResponse).text();
  expect(body).not.toMatch(/"radius"|"x":\s*0\./);

  await expect(page.getByTestId("result")).toContainText("Found 3 of 3");
  await expect(page.getByTestId("leaderboard").locator("tr[data-viewer]")).toHaveCount(1);

  // One shot: reloading shows the result again, never the canvas.
  await page.reload();
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("marker-canvas")).toHaveCount(0);
});
```

- [ ] **Step 5: Lifecycle spec**

`e2e/lifecycle.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { seed } from "./seed-data";

test("a scheduled game is 404 to a non-master", async ({ page }) => {
  const res = await page.goto(`/g/${seed().theirs.scheduled.publicId}`);
  expect(res?.status()).toBe(404);
});

test("a scheduled game renders for its master", async ({ page }) => {
  const { scheduled } = seed().mine;
  await page.goto(`/g/${scheduled.publicId}`);
  await expect(page).toHaveURL(new RegExp(`/games/${scheduled.id}$`));
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
});

test("a finished game reveals positions and the final board", async ({ page }) => {
  await page.goto(`/g/${seed().theirs.finished.publicId}`);
  await expect(page.getByTestId("marker-canvas")).toHaveAttribute("data-mode", "reveal");
  await expect(page.getByTestId("marker")).toHaveCount(3);
  const rows = page.getByTestId("leaderboard").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Player 1"); // 3 found
  await expect(rows.nth(2)).toContainText("Player 3"); // 0 found, still listed (SPEC §3.4)
});
```

- [ ] **Step 6: Author spec**

`e2e/author.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { drag, within } from "./helpers";
import { seed } from "./seed-data";

test("master positions by dragging, confirms, and publishes", async ({ page }) => {
  const { draft } = seed().mine;
  await page.goto(`/games/${draft.id}`);
  const canvas = page.getByTestId("marker-canvas");
  await expect(canvas).toHaveAttribute("data-mode", "author");
  const markers = page.getByTestId("marker");
  await expect(markers).toHaveCount(3);
  const badge = (text: "confirmed" | "unconfirmed") => page.getByText(text, { exact: true });
  await expect(badge("unconfirmed")).toHaveCount(1);

  // Invariant 4 at the UI: publish is refused while any object is unconfirmed.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert")).toContainText(/not confirmed/);

  // Moving a confirmed object un-confirms it (Phase 1 rule, visible here).
  await drag(page, markers.nth(0), await within(canvas, 0.4, 0.4));
  await expect(badge("unconfirmed")).toHaveCount(2);

  // Confirm each row, then publish.
  for (let i = 0; i < 3; i++) {
    const next = page.getByRole("button", { name: "Confirm" }).and(page.locator(":enabled")).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await expect(badge("unconfirmed")).toHaveCount(1 - i < 0 ? 0 : 1 - i);
  }
  await expect(badge("unconfirmed")).toHaveCount(0);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-mode", "reveal");
});
```

- [ ] **Step 7: Run locally**

Run: `npm run test:e2e`
Expected: global setup prints the seed lines, then 5 tests pass. `e2e/.auth/` exists and is untracked (`git status` shows nothing under it). If `clerk.signIn` fails with a bot-detection error, confirm `clerkSetup()` ran before the browser launched and `CLERK_SECRET_KEY` belongs to the same instance as the publishable key.

- [ ] **Step 8: Verify and commit**

Run: `npm run verify && npx knip`

```bash
git add playwright.config.ts e2e package.json package-lock.json knip.json
git commit -m "test(e2e): Playwright harness — seeded play, lifecycle, and authoring flows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 8: CI `e2e` job

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `integration` job (migrates the test branch first; same concurrency group serialises the two).
- Produces: job `e2e` with `outputs.status` ∈ `pass | skipped`; `report` row; `update-baseline` gated on `pass`.

- [ ] **Step 1: Add the job after `integration`**

```yaml
  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    needs: [integration]
    concurrency:
      group: integration-neon
      cancel-in-progress: false
    outputs:
      status: ${{ steps.run.outputs.status || steps.skip.outputs.status }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - id: secrets
        shell: bash
        env:
          DB: ${{ secrets.TEST_DATABASE_URL }}
          AWS: ${{ secrets.AWS_ACCESS_KEY_ID }}
          CLERK: ${{ secrets.CLERK_SECRET_KEY }}
          PK: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
        run: |
          if [ -n "$DB" ] && [ -n "$AWS" ] && [ -n "$CLERK" ] && [ -n "$PK" ]; then
            echo "present=true" >> "$GITHUB_OUTPUT"
          else
            echo "present=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Install Chromium
        if: steps.secrets.outputs.present == 'true'
        run: npx playwright install --with-deps chromium
      - name: Run Playwright
        id: run
        if: steps.secrets.outputs.present == 'true'
        shell: bash
        env:
          CI: "1"
          # The test branch, already migrated by the integration job.
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
          DATABASE_URL_UNPOOLED: ${{ secrets.TEST_DATABASE_URL_UNPOOLED }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_ENDPOINT_URL_S3: ${{ secrets.AWS_ENDPOINT_URL_S3 }}
          AWS_REGION: ${{ secrets.AWS_REGION }}
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
          CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
          NEXT_PUBLIC_CLERK_SIGN_IN_URL: /sign-in
          NEXT_PUBLIC_CLERK_SIGN_UP_URL: /sign-up
          NEXT_PUBLIC_APP_URL: http://localhost:3000
          E2E_CLERK_USER_ID: ${{ secrets.E2E_CLERK_USER_ID }}
        run: |
          npm run test:e2e
          echo "status=pass" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v4
        if: failure() && steps.secrets.outputs.present == 'true'
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
      - name: Secrets not configured
        id: skip
        if: steps.secrets.outputs.present == 'false'
        shell: bash
        run: |
          echo "::warning::E2E skipped: needs TEST_DATABASE_URL, AWS_*, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY"
          echo "status=skipped" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Report and baseline wiring**

In `report`: add `e2e` to `needs`, add env `E2E_STATUS: ${{ needs.e2e.outputs.status }}`, and append to `checks` after the integration row:

```js
              { name: 'e2e',         status: process.env.E2E_STATUS === 'pass' ? 'pass' : process.env.E2E_STATUS === 'skipped' ? 'skipped' : 'fail', prev: null, curr: null, unit: null },
```

In `update-baseline`: add `e2e` to `needs` and the condition line `needs.e2e.outputs.status == 'pass'` after the integration one. E2E must run — not skip — before `main` ratchets. Same rule as integration.

- [ ] **Step 3: Validate and commit**

Run: `npx --yes action-validator .github/workflows/ci.yml || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: parses.

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run Playwright against the Neon test branch after integration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

## Self-review

**Spec coverage** (design doc ↔ tasks): rendering + geometry → T1/T3; three modes → T3; play surface, all branches, image-before-Start by prop shape → T5; authoring integration → T6; seed (7 games, fixtures, lock discipline) → T2; E2E with sign-in token, network assertion, three specs → T7; CI job, skip semantics, baseline gate → T8; coverage opt-in → T1. SPEC §8 gameplay criteria each map to an assertion in `play.spec.ts` / `lifecycle.spec.ts`; "publish blocked with unconfirmed object" to `author.spec.ts`.

**Type consistency:** `CanvasMarker`, `MarkerCanvasProps` callbacks (`onAdd/onMove/onResize/onRemove/onSelect`) used identically in T5 and T6; `markerReducer(state, action, max)` matches T5's `useReducer` wrapper; `formatElapsed` used by T4 and T5; seed `--json` shape matches `e2e/seed-data.ts`; DOM test ids (`marker-canvas`, `marker`, `radius-handle`, `trash-zone`, `timer`, `object-rail`, `leaderboard`, `submit`, `confirm-submit`, `confirm-submit-yes`, `marker-count`, `result`, `object-chip`) appear in both producer and consumer tasks.

**Deferred (recorded, not hidden):** `object-chip` is emitted but no spec clicks it (placing an unplaced object has no seeded case — the seed positions every object). `E2E_CLERK_USER_ID` is optional; if Backend-API user creation is refused on the Google-only instance, set that secret to a user created in the dashboard.
