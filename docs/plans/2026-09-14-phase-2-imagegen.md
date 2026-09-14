# Phase 2 — Image Generation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the composite image and per-object position proposals for a draft game — compose → pixel-diff → vision labels → validate → adjust & retry (≤3) — with every attempt persisted to `generation_runs`, a deterministic paste backend behind a flag, a master-side Generate panel, and a golden-set eval.

**Architecture:** Pure modules (`prompt`, `diff`, `validate`, `boxes`, `status`, `placement`, `labels`) carry the logic and sit in the coverage ratchet. `attemptOnce(backend, input, adjustments)` composes them once per attempt and is shared by the DB-backed loop (`run.ts`) and the eval. A `GenerationBackend` interface isolates Gemini; `paste` implements the same interface deterministically. The loop runs inside Next's `after()` from a server action; the master page polls with `router.refresh()`.

**Tech Stack:** `@google/genai` (`gemini-3.1-flash-image` / `gemini-3.1-flash`), `sharp`, Drizzle, Next 16 `after`, Vitest 5, Playwright.

**Spec:** `docs/specs/2026-09-14-phase-2-imagegen-design.md` (design, approved 2026-09-14); `docs/SPEC.md` §5.3, §5.4, §8; `docs/handoffs/phase-3.md` (`putObject` → `setGeneratedImage` contract; canvas test ids); `docs/handoffs/phase-1.md` (lock discipline).

## Global Constraints

- Node `22.23.2`; `npm run verify` green before every commit (Stop hook). Coverage on `npm run test:cov` must stay ≥ **98.03** (`quality-baseline.json`) — the pure generation modules opted into coverage in Task 1 must be tested to that standard.
- TypeScript strict, no `any`, no non-null assertions. Drizzle only. `sharp` and `@google/genai` are the only new runtime deps.
- **Frozen contract:** `src/db/schema.ts`, `src/lib/types.ts`, `src/lib/visibility.ts`, `src/lib/scoring.ts`. Do not edit. `src/lib/games/**` is Phase 1's: the only sanctioned writer of `games.generated_image_key` and `objects.x/y/radius/confirmed` is `setGeneratedImage`; this stream never writes those columns. `src/lib/games/result.ts`'s `ActionError` union is not extended — reuse `INVALID_INPUT` / `NOT_DRAFT` / `NO_OBJECTS` / `NOT_FOUND` / `NOT_MASTER` with specific messages.
- **Coordinates are normalized against the generated image** — its *actual* output dimensions, read from the bytes, never assumed. Never pixels across a module boundary except inside `diff.ts`/`images.ts`.
- **Every attempt is persisted**: a `generation_runs` row exists before the backend is called and is finalized (`passed`/`failed`) in every code path including thrown errors. Retry cap `MAX_GENERATION_ATTEMPTS` (3) per request. No retry without a changed prompt.
- **Pure stays pure:** `prompt`, `diff`, `validate`, `boxes`, `status`, `placement`, `labels` have no I/O and no `sharp`.
- Stream B owns `src/lib/generation/**`, `evals/generation/**`, `src/app/api/generate/**` (stays empty). Allowed integration edits: `src/app/(master)/games/[id]/page.tsx` (Generation section + `maxDuration`), new `generation-panel.tsx` there, `src/lib/storage.ts` (add `getObject`), `vitest.config.ts`, `knip.json`, `package.json`, `.env.example`, `.github/workflows/ci.yml` (env var only), `playwright.config.ts` (webServer env), `e2e/generate.spec.ts`.
- Never write `.env*` except `.env.example`. Real Gemini calls are allowed locally (key in `.env.local`) but bounded: a handful per task; never in tests that CI runs; never in the unit or integration suites.
- Colocate unit tests as `src/lib/generation/__tests__/*.test.ts`, integration as `*.integration.test.ts` (Neon test branch, `TEST_DATABASE_URL`).
- `"use server"` files export only async functions; no `setState` inside `useEffect` (an effect that only calls `router.refresh()` is fine).
- Commit after every task with this exact two-line footer, nothing else in the footer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB`

---

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/generation/types.ts` | Shared types and thresholds |
| `src/lib/generation/boxes.ts` | Pure box maths: overlap, margin, circle, scale ratio |
| `src/lib/generation/validate.ts` | Pure SPEC §5.3 predicate |
| `src/lib/generation/prompt.ts` | Pure compose prompt + adjustment table |
| `src/lib/generation/status.ts` | Pure run-list → state |
| `src/lib/generation/diff.ts` | Pure pixel diff over RGBA buffers |
| `src/lib/generation/labels.ts` | Pure parser for the vision JSON |
| `src/lib/generation/placement.ts` | Pure seeded placement for paste mode |
| `src/lib/generation/images.ts` | sharp I/O |
| `src/lib/generation/backend.ts` | `GenerationBackend` interface + `backendFromEnv` |
| `src/lib/generation/paste.ts` | Paste backend (sharp composite) |
| `src/lib/generation/gemini.ts` | Gemini backend |
| `src/lib/generation/attempt.ts` | `attemptOnce` |
| `src/lib/generation/run.ts` | `startGeneration`, `runGeneration`, `loadGameInput` |
| `src/lib/generation/actions.ts` | `startGenerationAction` |
| `src/app/(master)/games/[id]/generation-panel.tsx` | Generate button, run list, poller |
| `evals/generation/{make-golden,eval}.ts`, `golden/**` | Golden set + eval harness |
| `e2e/generate.spec.ts` | Upload → generate → confirm → publish |

---

### Task 1: Types, box maths, validation

**Files:**
- Create: `src/lib/generation/types.ts`, `src/lib/generation/boxes.ts`, `src/lib/generation/validate.ts`
- Test: `src/lib/generation/__tests__/boxes.test.ts`, `src/lib/generation/__tests__/validate.test.ts`
- Modify: `vitest.config.ts` (coverage)

**Interfaces:**
- Consumes: `normalized`, `Normalized`, `NormalizedCircle`, `ImageSize` from `@/lib/types`.
- Produces: everything in `types.ts` below; `overlapFraction`, `insideMargin`, `toCircle`, `scaleRatio`; `validate(objects, candidates, labels, image)`.

- [ ] **Step 1: `types.ts`**

```ts
/**
 * Shared shapes for the generation pipeline (SPEC §5.3). Boxes are normalized against
 * the generated image: x/y top-left, w/h as fractions of width/height.
 */
import type { Normalized } from "@/lib/types";

export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
/** A changed region found by the pixel diff. `area` is the box's fraction of the frame. */
export type Candidate = Box & { readonly area: number };
/** One vision assignment: candidate index → object (or null when the region is nothing we asked for). */
export type VisionLabel = { readonly candidate: number; readonly objectId: string | null; readonly confidence: number };
export type Proposal = { readonly objectId: string; readonly x: Normalized; readonly y: Normalized; readonly radius: Normalized };

export const FAILURE_CLASSES = ["absent", "low_confidence", "overlap", "out_of_bounds", "scale", "config", "error", "stale"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type Failure = { readonly objectId: string | null; readonly class: FailureClass; readonly detail: string };
/** A prompt addition for the next attempt; `objectId` null = applies to the whole scene. */
export type Adjustment = { readonly objectId: string | null; readonly text: string };

export type ValidationResult = { readonly ok: true; readonly proposals: readonly Proposal[] } | { readonly ok: false; readonly failures: readonly Failure[] };

export type ObjectInput = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly requestedScale: number | null;
  readonly sortOrder: number;
  readonly image: Uint8Array;
};
export type GameInput = {
  readonly id: string;
  readonly title: string;
  readonly generalPrompt: string;
  readonly background: Uint8Array;
  readonly objects: readonly ObjectInput[];
};
export type ComposeResult = { readonly png: Uint8Array; readonly width: number; readonly height: number };

export const CONFIDENCE_THRESHOLD = 0.6;
export const FRAME_MARGIN = 0.03;
export const MAX_OVERLAP = 0.2;
/** Box area may be within this factor of the requested scale, either way. */
export const SCALE_TOLERANCE = 10;
export const STALE_AFTER_MS = 10 * 60_000;
```

- [ ] **Step 2: Failing tests for `boxes`**

`src/lib/generation/__tests__/boxes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insideMargin, overlapFraction, scaleRatio, toCircle } from "../boxes";

const image = { width: 1000, height: 500 };

describe("overlapFraction", () => {
  it("is 0 for disjoint boxes", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });
  it("is intersection over the smaller box", () => {
    // small 0.1×0.1 box half inside a big one → 0.5
    expect(overlapFraction({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.45, y: 0, w: 0.1, h: 0.1 })).toBeCloseTo(0.5, 10);
  });
  it("is 1 when one box contains the other", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBe(1);
  });
  it("treats touching edges as no overlap", () => {
    expect(overlapFraction({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.1, y: 0, w: 0.1, h: 0.1 })).toBe(0);
  });
});

describe("insideMargin", () => {
  it("accepts a box strictly inside the margin, inclusive at the boundary", () => {
    expect(insideMargin({ x: 0.03, y: 0.03, w: 0.94, h: 0.94 }, 0.03)).toBe(true);
  });
  it("rejects a box crossing any edge", () => {
    expect(insideMargin({ x: 0.02, y: 0.5, w: 0.1, h: 0.1 }, 0.03)).toBe(false);
    expect(insideMargin({ x: 0.5, y: 0.5, w: 0.5, h: 0.1 }, 0.03)).toBe(false);
  });
});

describe("toCircle", () => {
  it("centres the box and uses the larger side in width units (aspect-aware)", () => {
    // 2:1 image: a box 0.1 wide and 0.1 tall is 100px × 50px → radius 50px = 0.05 of width
    const c = toCircle({ x: 0.2, y: 0.4, w: 0.1, h: 0.1 }, image);
    expect(c.x).toBeCloseTo(0.25, 10);
    expect(c.y).toBeCloseTo(0.45, 10);
    expect(c.radius).toBeCloseTo(0.05, 10);
    // tall box: 0.02 wide (20px), 0.2 tall (100px) → radius 50px = 0.05
    expect(toCircle({ x: 0, y: 0, w: 0.02, h: 0.2 }, image).radius).toBeCloseTo(0.05, 10);
  });
  it("caps the radius at 0.5", () => {
    expect(toCircle({ x: 0, y: 0, w: 1, h: 1 }, { width: 100, height: 400 }).radius).toBe(0.5);
  });
});

describe("scaleRatio", () => {
  it("is 1 when the box area matches a square of requestedScale width", () => {
    // requestedScale 0.1 on a 2:1 image: 100px wide square → 100×100px = w 0.1, h 0.2
    expect(scaleRatio({ x: 0, y: 0, w: 0.1, h: 0.2 }, 0.1, image)).toBeCloseTo(1, 10);
  });
  it("scales with area", () => {
    expect(scaleRatio({ x: 0, y: 0, w: 0.2, h: 0.4 }, 0.1, image)).toBeCloseTo(4, 10);
  });
});
```

- [ ] **Step 3: Failing tests for `validate`**

`src/lib/generation/__tests__/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validate } from "../validate";
import type { Candidate, VisionLabel } from "../types";

const image = { width: 1000, height: 1000 };
const box = (x: number, y: number, w = 0.1, h = 0.1): Candidate => ({ x, y, w, h, area: w * h });
const objects = [
  { id: "a", label: "Cup", requestedScale: null },
  { id: "b", label: "Duck", requestedScale: null },
];

describe("validate", () => {
  it("passes with one confident, in-bounds, separated candidate per object", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6)];
    const labels: VisionLabel[] = [
      { candidate: 0, objectId: "a", confidence: 0.9 },
      { candidate: 1, objectId: "b", confidence: 0.8 },
    ];
    const r = validate(objects, candidates, labels, image);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposals.map((p) => p.objectId)).toEqual(["a", "b"]);
      expect(r.proposals[0]).toEqual({ objectId: "a", x: 0.25, y: 0.25, radius: 0.05 });
    }
  });
  it("reports absent when an object has no matched candidate", () => {
    const r = validate(objects, [box(0.2, 0.2)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "b", class: "absent", detail: "no changed region was labelled as this object" }] });
  });
  it("ignores labels pointing at unknown candidates or unknown objects", () => {
    const r = validate(objects, [box(0.2, 0.2)], [{ candidate: 5, objectId: "a", confidence: 0.9 }, { candidate: 0, objectId: "zzz", confidence: 0.9 }], image);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.objectId)).toEqual(["a", "b"]);
  });
  it("keeps the most confident match and drops a decoy", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6), box(0.2, 0.7)];
    const labels: VisionLabel[] = [
      { candidate: 0, objectId: "a", confidence: 0.7 },
      { candidate: 2, objectId: "a", confidence: 0.95 },
      { candidate: 1, objectId: "b", confidence: 0.8 },
    ];
    const r = validate(objects, candidates, labels, image);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposals[0].y).toBeCloseTo(0.75, 10);
  });
  it("reports low_confidence at the threshold boundary (< 0.6 fails, 0.6 passes)", () => {
    const candidates = [box(0.2, 0.2), box(0.6, 0.6)];
    const at = validate(objects, candidates, [{ candidate: 0, objectId: "a", confidence: 0.6 }, { candidate: 1, objectId: "b", confidence: 0.6 }], image);
    expect(at.ok).toBe(true);
    const below = validate(objects, candidates, [{ candidate: 0, objectId: "a", confidence: 0.59 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(below).toEqual({ ok: false, failures: [{ objectId: "a", class: "low_confidence", detail: "confidence 0.59 is below 0.6" }] });
  });
  it("reports out_of_bounds for a box inside the 3% margin", () => {
    const r = validate(objects, [box(0.01, 0.5), box(0.6, 0.6)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "a", class: "out_of_bounds", detail: "box crosses the outer 3% margin" }] });
  });
  it("reports overlap above 20% for both objects, once each", () => {
    const r = validate(objects, [box(0.2, 0.2), box(0.25, 0.2)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.map((f) => [f.objectId, f.class])).toEqual([["a", "overlap"], ["b", "overlap"]]);
      expect(r.failures[0].detail).toBe("Cup overlaps Duck by 50%");
    }
  });
  it("accepts overlap at exactly 20%", () => {
    const r = validate(objects, [box(0.2, 0.2), box(0.28, 0.2)], [{ candidate: 0, objectId: "a", confidence: 0.9 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r.ok).toBe(true);
  });
  it("reports scale when the area is more than 10× off the requested scale, either way", () => {
    const scaled = [{ id: "a", label: "Cup", requestedScale: 0.1 }];
    const tooBig = validate(scaled, [box(0.2, 0.2, 0.4, 0.4)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(tooBig).toEqual({ ok: false, failures: [{ objectId: "a", class: "scale", detail: "box area is 16.0× the requested scale" }] });
    const tooSmall = validate(scaled, [box(0.2, 0.2, 0.02, 0.02)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(tooSmall.ok).toBe(false);
    const fine = validate(scaled, [box(0.2, 0.2, 0.3, 0.3)], [{ candidate: 0, objectId: "a", confidence: 0.9 }], image);
    expect(fine.ok).toBe(true);
  });
  it("reports only the first failing class per object, in SPEC order", () => {
    // a: low confidence AND out of bounds → low_confidence wins
    const r = validate(objects, [box(0.0, 0.5), box(0.6, 0.6)], [{ candidate: 0, objectId: "a", confidence: 0.1 }, { candidate: 1, objectId: "b", confidence: 0.9 }], image);
    expect(r).toEqual({ ok: false, failures: [{ objectId: "a", class: "low_confidence", detail: "confidence 0.10 is below 0.6" }] });
  });
});
```

- [ ] **Step 4: Run tests — expect FAIL (modules missing)**

Run: `npx vitest run src/lib/generation`

- [ ] **Step 5: Implement `boxes.ts`**

```ts
/** Pure box maths over normalized boxes (see types.ts). No I/O. */
import { normalized, type ImageSize, type NormalizedCircle } from "@/lib/types";
import type { Box } from "./types";

/** Intersection area over the smaller box's area; 0 when disjoint or merely touching. */
export function overlapFraction(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

/** True when the whole box lies inside the frame minus `margin` on every side (inclusive). */
export function insideMargin(b: Box, margin: number): boolean {
  return b.x >= margin && b.y >= margin && b.x + b.w <= 1 - margin && b.y + b.h <= 1 - margin;
}

/**
 * The hit circle for a box: its centre, and half its larger side measured in width units
 * — the same aspect-aware unit scoring.ts uses. Capped at 0.5.
 */
export function toCircle(b: Box, image: ImageSize): NormalizedCircle {
  const hInWidthUnits = (b.h * image.height) / image.width;
  const r = Math.max(b.w, hInWidthUnits) / 2;
  return { x: normalized(b.x + b.w / 2), y: normalized(b.y + b.h / 2), radius: normalized(Math.min(0.5, r)) };
}

/**
 * Box area relative to the area a square of `requestedScale × width` pixels would cover.
 * 1 = exactly the requested size; SPEC §5.3 tolerates an order of magnitude either way.
 */
export function scaleRatio(b: Box, requestedScale: number, image: ImageSize): number {
  const expected = requestedScale * requestedScale * (image.width / image.height);
  return (b.w * b.h) / expected;
}
```

- [ ] **Step 6: Implement `validate.ts`**

```ts
/**
 * SPEC §5.3 validation predicate. Pure: candidates + vision labels in, proposals or
 * failures out. Per object the checks run in SPEC order and the first failure wins;
 * overlap is checked last, pairwise, among objects that passed their own checks.
 */
import type { ImageSize } from "@/lib/types";
import { insideMargin, overlapFraction, scaleRatio, toCircle } from "./boxes";
import { CONFIDENCE_THRESHOLD, FRAME_MARGIN, MAX_OVERLAP, SCALE_TOLERANCE, type Box, type Candidate, type Failure, type ValidationResult, type VisionLabel } from "./types";

export type ValidatableObject = { readonly id: string; readonly label: string; readonly requestedScale: number | null };

export function validate(
  objects: readonly ValidatableObject[],
  candidates: readonly Candidate[],
  labels: readonly VisionLabel[],
  image: ImageSize,
): ValidationResult {
  const failures: Failure[] = [];
  const matched = new Map<string, Box>();
  const known = new Set(objects.map((o) => o.id));

  // Best label per object; labels for unknown candidates/objects are noise from the model.
  const best = new Map<string, VisionLabel>();
  for (const l of labels) {
    if (l.objectId === null || !known.has(l.objectId) || !candidates[l.candidate]) continue;
    const prev = best.get(l.objectId);
    if (!prev || l.confidence > prev.confidence) best.set(l.objectId, l);
  }

  for (const o of objects) {
    const l = best.get(o.id);
    if (!l) {
      failures.push({ objectId: o.id, class: "absent", detail: "no changed region was labelled as this object" });
      continue;
    }
    if (l.confidence < CONFIDENCE_THRESHOLD) {
      failures.push({ objectId: o.id, class: "low_confidence", detail: `confidence ${l.confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}` });
      continue;
    }
    const box = candidates[l.candidate];
    if (!insideMargin(box, FRAME_MARGIN)) {
      failures.push({ objectId: o.id, class: "out_of_bounds", detail: `box crosses the outer ${FRAME_MARGIN * 100}% margin` });
      continue;
    }
    if (o.requestedScale !== null) {
      const ratio = scaleRatio(box, o.requestedScale, image);
      if (ratio > SCALE_TOLERANCE || ratio < 1 / SCALE_TOLERANCE) {
        failures.push({ objectId: o.id, class: "scale", detail: `box area is ${ratio.toFixed(1)}× the requested scale` });
        continue;
      }
    }
    matched.set(o.id, box);
  }

  const passed = objects.filter((o) => matched.has(o.id));
  const overlapped = new Set<string>();
  for (let i = 0; i < passed.length; i++) {
    for (let j = i + 1; j < passed.length; j++) {
      const a = passed[i];
      const b = passed[j];
      const f = overlapFraction(matched.get(a.id) as Box, matched.get(b.id) as Box);
      if (f <= MAX_OVERLAP) continue;
      const pct = `${Math.round(f * 100)}%`;
      if (!overlapped.has(a.id)) failures.push({ objectId: a.id, class: "overlap", detail: `${a.label} overlaps ${b.label} by ${pct}` });
      if (!overlapped.has(b.id)) failures.push({ objectId: b.id, class: "overlap", detail: `${b.label} overlaps ${a.label} by ${pct}` });
      overlapped.add(a.id).add(b.id);
    }
  }

  if (failures.length > 0) {
    const order = new Map(objects.map((o, i) => [o.id, i]));
    failures.sort((p, q) => (order.get(p.objectId ?? "") ?? 0) - (order.get(q.objectId ?? "") ?? 0));
    return { ok: false, failures };
  }
  return { ok: true, proposals: objects.map((o) => ({ objectId: o.id, ...toCircle(matched.get(o.id) as Box, image) })) };
}
```

Note: the overlap test in Step 3 expects `"Cup overlaps Duck by 50%"` for boxes at x=0.2 and x=0.25 of width 0.1 → intersection 0.05×0.1 over 0.1×0.1 = 0.5 ✓; the "exactly 20%" case uses x=0.28 → 0.02/0.1 = 0.2 → passes ✓. The `as Box` casts are on values guaranteed by `matched.has` — keep them; do not use `!`.

- [ ] **Step 7: Coverage opt-in**

In `vitest.config.ts` coverage `exclude`, replace `"src/lib/generation/**",` with the I/O files only:

```ts
        // Generation: I/O adapters and the DB loop are exercised by integration tests and
        // the eval, not by unit coverage. The pure modules stay in the ratchet.
        "src/lib/generation/images.ts",
        "src/lib/generation/gemini.ts",
        "src/lib/generation/paste.ts",
        "src/lib/generation/backend.ts",
        "src/lib/generation/attempt.ts",
        "src/lib/generation/run.ts",
        "src/lib/generation/actions.ts",
```

- [ ] **Step 8: Run tests, coverage, verify; commit**

Run: `npx vitest run src/lib/generation && npm run test:cov 2>&1 | tail -15 && npm run verify`
Expected: all pass; "All files" ≥ 98.03.

```bash
git add src/lib/generation vitest.config.ts
git commit -m "feat(generation): types, box maths, and the SPEC §5.3 validation predicate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 2: Prompt composition, adjustments, run state, label parsing

**Files:**
- Create: `src/lib/generation/prompt.ts`, `src/lib/generation/status.ts`, `src/lib/generation/labels.ts`
- Test: `src/lib/generation/__tests__/prompt.test.ts`, `status.test.ts`, `labels.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `GenerationRunStatus` from `@/lib/types`.
- Produces: `composePrompt(game, objects, adjustments)`, `adjustmentFor(failure, object)`, `mergeAdjustments(prev, next)`, `formatFailures(failures, objects)`, `formatAdjustments(adjs)`; `deriveGenerationState(runs, now)` + `GenerationState`; `parseLabels(text, candidateCount, objectIds)`.

- [ ] **Step 1: Failing tests**

`src/lib/generation/__tests__/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adjustmentFor, composePrompt, formatAdjustments, formatFailures, mergeAdjustments } from "../prompt";

const game = { generalPrompt: "A sunny kitchen, cartoon style, medium difficulty." };
const objects = [
  { id: "a", label: "Coffee mug", prompt: "on the counter, half behind the kettle", requestedScale: 0.1, sortOrder: 0 },
  { id: "b", label: "Rubber duck", prompt: "", requestedScale: null, sortOrder: 1 },
];

describe("composePrompt", () => {
  it("is deterministic and lists objects in sort order with their prompts and sizes", () => {
    const p = composePrompt(game, [...objects].reverse(), []);
    expect(p).toBe(composePrompt(game, objects, []));
    expect(p).toContain("A sunny kitchen, cartoon style, medium difficulty.");
    expect(p.indexOf("Coffee mug")).toBeLessThan(p.indexOf("Rubber duck"));
    expect(p).toContain("1. Coffee mug — on the counter, half behind the kettle — about 10% of the image width");
    expect(p).toContain("2. Rubber duck — placed somewhere plausible");
    expect(p).toContain("do not move, remove or restyle");
  });
  it("appends adjustments, object ones under their object and scene ones at the end", () => {
    const p = composePrompt(game, objects, [
      { objectId: "b", text: "Show the Rubber duck fully in view, not occluded by anything." },
      { objectId: null, text: "Keep every object well separated." },
    ]);
    expect(p).toContain("2. Rubber duck — placed somewhere plausible\n   Adjustment: Show the Rubber duck fully in view, not occluded by anything.");
    expect(p.trimEnd().endsWith("Keep every object well separated.")).toBe(true);
  });
});

describe("adjustmentFor", () => {
  const cup = objects[0];
  it("maps every prompt-related failure class per SPEC §5.3", () => {
    expect(adjustmentFor({ objectId: "a", class: "absent", detail: "" }, cup)).toEqual({
      objectId: "a",
      text: "Place the Coffee mug exactly as described (on the counter, half behind the kettle) and make it clearly visible and larger than before.",
    });
    expect(adjustmentFor({ objectId: "a", class: "low_confidence", detail: "" }, cup)?.text).toBe("Show the Coffee mug fully in view, not occluded by anything.");
    expect(adjustmentFor({ objectId: "a", class: "overlap", detail: "" }, cup)).toEqual({ objectId: null, text: "Keep every object well separated: at least a fifth of the image apart, none touching." });
    expect(adjustmentFor({ objectId: "a", class: "out_of_bounds", detail: "" }, cup)).toEqual({ objectId: null, text: "Place all objects within the central 80% of the frame, away from every edge." });
    expect(adjustmentFor({ objectId: "a", class: "scale", detail: "" }, cup)?.text).toBe("The Coffee mug should be roughly 10% of the image width — about the size of a prominent element of the scene.");
  });
  it("uses a default size when no scale was requested", () => {
    expect(adjustmentFor({ objectId: "b", class: "scale", detail: "" }, objects[1])?.text).toContain("roughly 12% of the image width");
  });
  it("returns null for failures a prompt cannot fix", () => {
    for (const c of ["config", "error", "stale"] as const) expect(adjustmentFor({ objectId: null, class: c, detail: "" }, null)).toBeNull();
  });
});

describe("mergeAdjustments / formatting", () => {
  it("appends without duplicating identical adjustments", () => {
    const a = { objectId: "a", text: "x" };
    expect(mergeAdjustments([a], [a, { objectId: null, text: "y" }])).toEqual([a, { objectId: null, text: "y" }]);
  });
  it("formats failures one per line with the object label", () => {
    expect(formatFailures([{ objectId: "a", class: "absent", detail: "no region" }, { objectId: null, class: "error", detail: "boom" }], objects)).toBe(
      "absent: Coffee mug — no region\nerror: boom",
    );
  });
  it("formats adjustments one per line", () => {
    expect(formatAdjustments([{ objectId: "a", text: "x" }, { objectId: null, text: "y" }])).toBe("x\ny");
    expect(formatAdjustments([])).toBeNull();
  });
});
```

`src/lib/generation/__tests__/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveGenerationState } from "../status";

const t = (min: number) => new Date(Date.UTC(2026, 8, 14, 12, min));
const run = (attemptNumber: number, status: "queued" | "running" | "passed" | "failed", startedMin: number, failureReason: string | null = null) => ({
  attemptNumber,
  status,
  failureReason,
  startedAt: t(startedMin),
  finishedAt: status === "passed" || status === "failed" ? t(startedMin + 1) : null,
});

describe("deriveGenerationState", () => {
  it("is idle with no runs", () => {
    expect(deriveGenerationState([], t(0))).toEqual({ kind: "idle" });
  });
  it("is running for a fresh running or queued run", () => {
    expect(deriveGenerationState([run(1, "running", 0)], t(5))).toEqual({ kind: "running", attemptNumber: 1, startedAt: t(0) });
    expect(deriveGenerationState([run(1, "queued", 0)], t(5))).toEqual({ kind: "running", attemptNumber: 1, startedAt: t(0) });
  });
  it("treats a run older than 10 minutes as stale", () => {
    expect(deriveGenerationState([run(2, "running", 0)], t(11))).toEqual({
      kind: "failed",
      attemptNumber: 2,
      reason: "stale: the generation was cut off before it finished",
      attempts: 1,
    });
    expect(deriveGenerationState([run(2, "running", 0)], t(10)).kind).toBe("running");
  });
  it("is passed when the latest run passed", () => {
    expect(deriveGenerationState([run(1, "failed", 0, "absent: x"), run(2, "passed", 2)], t(9))).toEqual({ kind: "passed", attemptNumber: 2, finishedAt: t(3) });
  });
  it("is failed with the latest reason and the length of the failed tail", () => {
    const runs = [run(1, "passed", 0), run(2, "failed", 2, "absent: a"), run(3, "failed", 4, "overlap: a — b")];
    expect(deriveGenerationState(runs, t(9))).toEqual({ kind: "failed", attemptNumber: 3, reason: "overlap: a — b", attempts: 2 });
  });
  it("orders by attempt number regardless of input order", () => {
    expect(deriveGenerationState([run(2, "passed", 2), run(1, "failed", 0, "x")], t(9)).kind).toBe("passed");
  });
});
```

`src/lib/generation/__tests__/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseLabels } from "../labels";

const ids = ["a", "b"];

describe("parseLabels", () => {
  it("parses a well-formed array", () => {
    expect(parseLabels('[{"candidate":0,"objectId":"a","confidence":0.9},{"candidate":1,"objectId":null,"confidence":0.2}]', 2, ids)).toEqual([
      { candidate: 0, objectId: "a", confidence: 0.9 },
      { candidate: 1, objectId: null, confidence: 0.2 },
    ]);
  });
  it("drops entries with out-of-range candidates or non-numeric confidence, clamps confidence, nulls unknown objects", () => {
    expect(parseLabels('[{"candidate":7,"objectId":"a","confidence":1},{"candidate":0,"objectId":"zzz","confidence":1.7},{"candidate":1,"objectId":"b"}]', 2, ids)).toEqual([
      { candidate: 0, objectId: null, confidence: 1 },
    ]);
  });
  it("accepts a fenced or wrapped payload and returns [] for anything unparseable", () => {
    expect(parseLabels('```json\n[{"candidate":0,"objectId":"b","confidence":0.5}]\n```', 1, ids)).toEqual([{ candidate: 0, objectId: "b", confidence: 0.5 }]);
    expect(parseLabels('{"labels":[{"candidate":0,"objectId":"b","confidence":0.5}]}', 1, ids)).toEqual([{ candidate: 0, objectId: "b", confidence: 0.5 }]);
    expect(parseLabels("not json", 1, ids)).toEqual([]);
    expect(parseLabels("42", 1, ids)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/lib/generation/__tests__/prompt.test.ts src/lib/generation/__tests__/status.test.ts src/lib/generation/__tests__/labels.test.ts`

- [ ] **Step 3: `prompt.ts`**

```ts
/**
 * The compose prompt and the SPEC §5.3 failure → adjustment table. Pure: the prompt is a
 * function of (game, objects, adjustments), so a retry is never a blind retry.
 */
import type { Adjustment, Failure } from "./types";

export type PromptObject = { readonly id: string; readonly label: string; readonly prompt: string; readonly requestedScale: number | null; readonly sortOrder: number };
export const DEFAULT_SCALE = 0.12;

const pct = (scale: number | null) => `${Math.round((scale ?? DEFAULT_SCALE) * 100)}%`;

export function composePrompt(game: { readonly generalPrompt: string }, objects: readonly PromptObject[], adjustments: readonly Adjustment[]): string {
  const sorted = [...objects].sort((a, b) => a.sortOrder - b.sortOrder);
  const lines: string[] = [];
  lines.push("You are compositing objects into a supplied scene for a hidden-object game.");
  lines.push(`Scene: ${game.generalPrompt.trim() || "as supplied"}`);
  lines.push("The first image is the background. Keep it exactly as supplied: do not move, remove or restyle existing elements. Blend each object in naturally (lighting, shadows, perspective).");
  lines.push("Objects to place, one per following image, in this order:");
  sorted.forEach((o, i) => {
    const placement = o.prompt.trim() || "placed somewhere plausible";
    const size = o.requestedScale === null ? "" : ` — about ${pct(o.requestedScale)} of the image width`;
    lines.push(`${i + 1}. ${o.label} — ${placement}${size}`);
    for (const a of adjustments) if (a.objectId === o.id) lines.push(`   Adjustment: ${a.text}`);
  });
  lines.push("Rules: every object fully visible; no two objects overlapping; nothing touching the image edges; keep each object recognisable from its reference image.");
  for (const a of adjustments) if (a.objectId === null) lines.push(a.text);
  return lines.join("\n");
}

/** SPEC §5.3 table. Null for failures a prompt cannot fix (config, error, stale). */
export function adjustmentFor(f: Failure, object: PromptObject | null): Adjustment | null {
  const label = object?.label ?? "the object";
  switch (f.class) {
    case "absent": {
      const how = object?.prompt.trim() ? `exactly as described (${object.prompt.trim()})` : "in a clearly visible spot";
      return { objectId: f.objectId, text: `Place the ${label} ${how} and make it clearly visible and larger than before.` };
    }
    case "low_confidence":
      return { objectId: f.objectId, text: `Show the ${label} fully in view, not occluded by anything.` };
    case "overlap":
      return { objectId: null, text: "Keep every object well separated: at least a fifth of the image apart, none touching." };
    case "out_of_bounds":
      return { objectId: null, text: "Place all objects within the central 80% of the frame, away from every edge." };
    case "scale":
      return { objectId: f.objectId, text: `The ${label} should be roughly ${pct(object?.requestedScale ?? null)} of the image width — about the size of a prominent element of the scene.` };
    case "config":
    case "error":
    case "stale":
      return null;
  }
}

export function mergeAdjustments(prev: readonly Adjustment[], next: readonly Adjustment[]): Adjustment[] {
  const out = [...prev];
  for (const a of next) if (!out.some((p) => p.objectId === a.objectId && p.text === a.text)) out.push(a);
  return out;
}

/** One line per failure: `class: Label — detail`, the shape stored in generation_runs.failure_reason. */
export function formatFailures(failures: readonly Failure[], objects: readonly { readonly id: string; readonly label: string }[]): string {
  return failures
    .map((f) => {
      const label = objects.find((o) => o.id === f.objectId)?.label;
      return label ? `${f.class}: ${label} — ${f.detail}` : `${f.class}: ${f.detail}`;
    })
    .join("\n");
}

export function formatAdjustments(adjs: readonly Adjustment[]): string | null {
  return adjs.length === 0 ? null : adjs.map((a) => a.text).join("\n");
}
```

- [ ] **Step 4: `status.ts`**

```ts
/** generation_runs rows → what the master sees. Pure; `now` is passed in (invariant 6 / UTC). */
import type { GenerationRunStatus } from "@/lib/types";
import { STALE_AFTER_MS } from "./types";

export type RunLike = {
  readonly attemptNumber: number;
  readonly status: GenerationRunStatus;
  readonly failureReason: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
};

export type GenerationState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly attemptNumber: number; readonly startedAt: Date }
  | { readonly kind: "passed"; readonly attemptNumber: number; readonly finishedAt: Date | null }
  | { readonly kind: "failed"; readonly attemptNumber: number; readonly reason: string; readonly attempts: number };

export const STALE_REASON = "stale: the generation was cut off before it finished";

export function deriveGenerationState(runs: readonly RunLike[], now: Date): GenerationState {
  const sorted = [...runs].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const latest = sorted.at(-1);
  if (!latest) return { kind: "idle" };
  if (latest.status === "running" || latest.status === "queued") {
    if (now.getTime() - latest.startedAt.getTime() > STALE_AFTER_MS) {
      return { kind: "failed", attemptNumber: latest.attemptNumber, reason: STALE_REASON, attempts: 1 };
    }
    return { kind: "running", attemptNumber: latest.attemptNumber, startedAt: latest.startedAt };
  }
  if (latest.status === "passed") return { kind: "passed", attemptNumber: latest.attemptNumber, finishedAt: latest.finishedAt };
  let attempts = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i].status === "failed"; i--) attempts++;
  return { kind: "failed", attemptNumber: latest.attemptNumber, reason: latest.failureReason ?? "unknown", attempts };
}
```

- [ ] **Step 5: `labels.ts`**

```ts
/** Parses the vision model's JSON into VisionLabel[]; tolerant of fences and wrappers, strict on shape. */
import type { VisionLabel } from "./types";

export function parseLabels(text: string, candidateCount: number, objectIds: readonly string[]): VisionLabel[] {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  const arr: unknown = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? (parsed as { labels?: unknown }).labels : undefined;
  if (!Array.isArray(arr)) return [];
  const known = new Set(objectIds);
  const out: VisionLabel[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const { candidate, objectId, confidence } = item as { candidate?: unknown; objectId?: unknown; confidence?: unknown };
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0 || candidate >= candidateCount) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    const id = typeof objectId === "string" && known.has(objectId) ? objectId : null;
    out.push({ candidate, objectId: id, confidence: Math.min(1, Math.max(0, confidence)) });
  }
  return out;
}
```

- [ ] **Step 6: Run tests, coverage, verify; commit**

Run: `npx vitest run src/lib/generation && npm run test:cov 2>&1 | tail -12 && npm run verify`
Expected: green; coverage ≥ 98.03.

```bash
git add src/lib/generation
git commit -m "feat(generation): prompt composition, adjustment table, run state, label parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 3: Pixel diff

**Files:**
- Create: `src/lib/generation/diff.ts`
- Test: `src/lib/generation/__tests__/diff.test.ts`

**Interfaces:**
- Produces: `DiffOptions`, `DIFF_DEFAULTS`, `diffMask`, `dilate`, `components`, `mergeBoxes`, `diffRegions(bg, gen, width, height, opts) → Candidate[]` (normalized, sorted by area desc, at most `opts.maxCandidates`).

- [ ] **Step 1: Failing tests**

`src/lib/generation/__tests__/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { components, DIFF_DEFAULTS, diffMask, diffRegions, dilate, mergeBoxes } from "../diff";

/** Solid-colour RGBA frame with optional rectangles painted over it. */
function frame(w: number, h: number, base: [number, number, number], rects: { x: number; y: number; w: number; h: number; c: [number, number, number] }[] = []): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...base, 255], i * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) px.set([...r.c, 255], (y * w + x) * 4);
  return px;
}
const grey: [number, number, number] = [128, 128, 128];
const red: [number, number, number] = [255, 0, 0];

describe("diffMask", () => {
  it("marks pixels whose max channel delta exceeds the threshold", () => {
    const a = frame(4, 1, grey);
    const b = frame(4, 1, grey, [{ x: 1, y: 0, w: 2, h: 1, c: [170, 128, 128] }]);
    expect(Array.from(diffMask(a, b, 4, 1, 40))).toEqual([0, 1, 1, 0]);
    expect(Array.from(diffMask(a, b, 4, 1, 42))).toEqual([0, 0, 0, 0]);
  });
});

describe("dilate", () => {
  it("grows a single pixel into its 3×3 neighbourhood, clipped at the edges", () => {
    const m = new Uint8Array(9);
    m[4] = 1;
    expect(Array.from(dilate(m, 3, 3))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const corner = new Uint8Array(9);
    corner[0] = 1;
    expect(Array.from(dilate(corner, 3, 3))).toEqual([1, 1, 0, 1, 1, 0, 0, 0, 0]);
  });
});

describe("components", () => {
  it("finds 8-connected blobs with pixel boxes", () => {
    const m = new Uint8Array(25);
    for (const i of [0, 1, 5, 6]) m[i] = 1; // 2×2 at top-left
    m[18] = 1; // diagonal neighbour of the next
    m[24] = 1; // bottom-right, 8-connected to 18
    expect(components(m, 5, 5)).toEqual([
      { x: 0, y: 0, w: 2, h: 2, pixels: 4 },
      { x: 3, y: 3, w: 2, h: 2, pixels: 2 },
    ]);
  });
  it("handles a fully set mask without recursion limits", () => {
    const m = new Uint8Array(200 * 200).fill(1);
    expect(components(m, 200, 200)).toEqual([{ x: 0, y: 0, w: 200, h: 200, pixels: 40000 }]);
  });
});

describe("mergeBoxes", () => {
  it("merges boxes that overlap or sit within the gap, transitively", () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 12, y: 0, w: 10, h: 10 },
      { x: 25, y: 0, w: 10, h: 10 },
      { x: 60, y: 60, w: 5, h: 5 },
    ];
    expect(mergeBoxes(boxes, 3)).toEqual([
      { x: 0, y: 0, w: 35, h: 10 },
      { x: 60, y: 60, w: 5, h: 5 },
    ]);
  });
});

describe("diffRegions", () => {
  it("returns one normalized candidate for one pasted rectangle", () => {
    const bg = frame(100, 50, grey);
    const gen = frame(100, 50, grey, [{ x: 10, y: 5, w: 20, h: 10, c: red }]);
    const [c, ...rest] = diffRegions(bg, gen, 100, 50);
    expect(rest).toEqual([]);
    // dilation grows the box by up to 2px per side; assert within that tolerance
    expect(c.x).toBeGreaterThanOrEqual(0.08);
    expect(c.x).toBeLessThanOrEqual(0.1);
    expect(c.w).toBeGreaterThanOrEqual(0.2);
    expect(c.w).toBeLessThanOrEqual(0.24);
    expect(c.area).toBeCloseTo(c.w * c.h, 10);
  });
  it("returns two candidates for two separated rectangles, largest first", () => {
    const bg = frame(100, 100, grey);
    const gen = frame(100, 100, grey, [
      { x: 5, y: 5, w: 10, h: 10, c: red },
      { x: 50, y: 50, w: 30, h: 30, c: red },
    ]);
    const cs = diffRegions(bg, gen, 100, 100);
    expect(cs).toHaveLength(2);
    expect(cs[0].area).toBeGreaterThan(cs[1].area);
  });
  it("ignores speckle noise below the minimum area and identical frames", () => {
    const bg = frame(100, 100, grey);
    const noisy = frame(100, 100, grey, [{ x: 40, y: 40, w: 1, h: 1, c: red }]);
    expect(diffRegions(bg, noisy, 100, 100, { ...DIFF_DEFAULTS, dilations: 0 })).toEqual([]);
    expect(diffRegions(bg, bg, 100, 100)).toEqual([]);
  });
  it("caps the number of candidates", () => {
    const bg = frame(100, 100, grey);
    const rects = Array.from({ length: 6 }, (_, i) => ({ x: i * 16, y: 10, w: 8, h: 8, c: red }));
    const gen = frame(100, 100, grey, rects);
    expect(diffRegions(bg, gen, 100, 100, { ...DIFF_DEFAULTS, mergeGap: 0, maxCandidates: 4 })).toHaveLength(4);
  });
  it("throws on mismatched buffer sizes", () => {
    expect(() => diffRegions(new Uint8Array(16), new Uint8Array(32), 2, 2)).toThrow(/size/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `diff.ts`**

```ts
/**
 * Deterministic pixel diff: which regions of the generated image differ from the
 * background. Vision later labels only these regions (SPEC §5.3), so this is the
 * step that stops the model "finding" an object that was already in the scene.
 * Pure over RGBA Uint8Arrays; no image library.
 */
import type { Candidate } from "./types";

export type DiffOptions = {
  /** Max channel |Δ| (0–255) above which a pixel counts as changed. */
  readonly threshold: number;
  /** 3×3 dilation passes to close gaps between changed pixels. */
  readonly dilations: number;
  /** Components smaller than this fraction of the frame are noise. */
  readonly minAreaFraction: number;
  /** Boxes closer than this (fraction of the frame's width/height) are merged. */
  readonly mergeGap: number;
  readonly maxCandidates: number;
};
export const DIFF_DEFAULTS: DiffOptions = { threshold: 40, dilations: 2, minAreaFraction: 0.0005, mergeGap: 0.02, maxCandidates: 10 };

export type PixelBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type Component = PixelBox & { readonly pixels: number };

export function diffMask(a: Uint8Array, b: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const n = width * height;
  if (a.length !== n * 4 || b.length !== n * 4) throw new Error(`diff: buffer size mismatch (${a.length}, ${b.length}) for ${width}×${height}`);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
    if (d > threshold) mask[i] = 1;
  }
  return mask;
}

export function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** 8-connected components via an explicit stack (no recursion), in scan order. */
export function components(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let minX = width, minY = height, maxX = -1, maxY = -1, pixels = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % width;
      const y = (i - x) / width;
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (mask[j] === 1 && seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels });
  }
  return out;
}

function touches(a: PixelBox, b: PixelBox, gap: number): boolean {
  return a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h;
}

/** Union boxes that overlap or lie within `gap` pixels, until stable. */
export function mergeBoxes(boxes: readonly PixelBox[], gap: number): PixelBox[] {
  let current = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    const next: PixelBox[] = [];
    for (const b of current) {
      const i = next.findIndex((n) => touches(n, b, gap));
      if (i === -1) {
        next.push(b);
        continue;
      }
      const n = next[i];
      const x = Math.min(n.x, b.x);
      const y = Math.min(n.y, b.y);
      next[i] = { x, y, w: Math.max(n.x + n.w, b.x + b.w) - x, h: Math.max(n.y + n.h, b.y + b.h) - y };
      merged = true;
    }
    current = next;
  }
  return current;
}

export function diffRegions(bg: Uint8Array, gen: Uint8Array, width: number, height: number, opts: DiffOptions = DIFF_DEFAULTS): Candidate[] {
  let mask = diffMask(bg, gen, width, height, opts.threshold);
  for (let i = 0; i < opts.dilations; i++) mask = dilate(mask, width, height);
  const minPixels = opts.minAreaFraction * width * height;
  const boxes = components(mask, width, height).filter((c) => c.pixels >= minPixels);
  const gapPx = Math.round(opts.mergeGap * Math.max(width, height));
  return mergeBoxes(boxes, gapPx)
    .map((b) => ({ x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height, area: (b.w * b.h) / (width * height) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxCandidates);
}
```

Check against the tests: the speckle test disables dilation so the 1-px blob (area 1e-4 < 0.0005·10⁴ = 5 px) is dropped; the cap test uses `mergeGap: 0` so six 8-px squares 8 px apart stay separate. If `components` order differs from the test's expectation, fix the test's expected order only if the implementation is scan-ordered as specified — the 2×2 blob starts at index 0 and the diagonal pair at index 18, so the order above is right.

- [ ] **Step 4: Run tests, coverage, verify; commit**

Run: `npx vitest run src/lib/generation/__tests__/diff.test.ts && npm run test:cov 2>&1 | tail -12 && npm run verify`

```bash
git add src/lib/generation
git commit -m "feat(generation): deterministic pixel diff into candidate regions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 4: Image I/O, seeded placement, paste backend

**Files:**
- Create: `src/lib/generation/images.ts`, `src/lib/generation/placement.ts`, `src/lib/generation/backend.ts`, `src/lib/generation/paste.ts`
- Test: `src/lib/generation/__tests__/placement.test.ts`, `src/lib/generation/__tests__/paste.test.ts` (uses sharp on tiny synthetic PNGs — allowed: pure-data in, bytes out, no network)
- Modify: `package.json` (`sharp` dependency), `src/lib/storage.ts` (add `getObject`)

**Interfaces:**
- Produces: `images.ts` — `decodeRGBA(png) → {data,width,height}`, `dimensions(png) → ImageSize`, `diffScale(size, max=512) → ImageSize`, `toRGBAAt(png, size)`, `cropPng(png, box, size)`, `compositePng(background, layers: {png, box}[]) → Uint8Array`, `encodePng(rgba, size)`; `placement.ts` — `seededRandom(seed)`, `placeObjects(objects, image, seed, opts) → Box[]`; `backend.ts` — `GenerationBackend`, `ComposeInput`, `LabelInput`, `LabelResult`, `backendFromEnv(env)`; `paste.ts` — `createPasteBackend()`; `storage.ts` — `getObject(key) → Uint8Array`.

- [ ] **Step 1: Install and storage read**

```bash
npm install sharp
```

Append to `src/lib/storage.ts`:

```ts
/** Server-side read (generation needs the background and object bytes). */
export async function getObject(key: string): Promise<Uint8Array> {
  const r = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!r.Body) throw new Error(`storage: empty body for ${key}`);
  return r.Body.transformToByteArray();
}
```

- [ ] **Step 2: Failing tests**

`src/lib/generation/__tests__/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { overlapFraction } from "../boxes";
import { placeObjects, seededRandom } from "../placement";

const image = { width: 1024, height: 768 };
const five = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, requestedScale: null, aspect: 1 }));

describe("seededRandom", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = seededRandom("game-1");
    const b = seededRandom("game-1");
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(seededRandom("game-2")()).not.toBe(xs[0]);
  });
});

describe("placeObjects", () => {
  it("places five objects inside the margin without overlap, deterministically", () => {
    const boxes = placeObjects(five, image, "seed");
    expect(boxes).toHaveLength(5);
    expect(placeObjects(five, image, "seed")).toEqual(boxes);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0.1);
      expect(b.y).toBeGreaterThanOrEqual(0.1);
      expect(b.x + b.w).toBeLessThanOrEqual(0.9);
      expect(b.y + b.h).toBeLessThanOrEqual(0.9);
    }
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(overlapFraction(boxes[i], boxes[j])).toBe(0);
  });
  it("sizes each box from requestedScale (or 0.12) as a fraction of width, aspect-aware", () => {
    const [b] = placeObjects([{ id: "a", requestedScale: 0.2, aspect: 2 }], image, "s"); // aspect = height/width of the sprite
    expect(b.w).toBeCloseTo(0.2, 10);
    expect(b.h).toBeCloseTo((0.2 * 2 * image.width) / image.height, 10);
    expect(placeObjects([{ id: "a", requestedScale: null, aspect: 1 }], image, "s")[0].w).toBeCloseTo(0.12, 10);
  });
  it("throws when nothing fits", () => {
    expect(() => placeObjects([{ id: "a", requestedScale: 0.9, aspect: 1 }], image, "s")).toThrow(/place/);
  });
});
```

`src/lib/generation/__tests__/paste.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeRGBA, dimensions, encodePng } from "../images";
import { createPasteBackend } from "../paste";
import { diffRegions } from "../diff";

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return encodePng(data, { width, height });
}

describe("paste backend", () => {
  it("composites objects at its own placements and labels the matching candidates", async () => {
    const background = await solid(200, 100, [120, 120, 120]);
    const sprite = await solid(10, 10, [255, 0, 0]);
    const game = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "t",
      generalPrompt: "",
      background,
      objects: [
        { id: "a", label: "A", prompt: "", requestedScale: 0.1, sortOrder: 0, image: sprite },
        { id: "b", label: "B", prompt: "", requestedScale: 0.1, sortOrder: 1, image: sprite },
      ],
    };
    const backend = createPasteBackend();
    const scene = await backend.compose({ ...game, prompt: "ignored" });
    expect(await dimensions(scene.png)).toEqual({ width: 200, height: 100 });
    const bg = await decodeRGBA(background);
    const gen = await decodeRGBA(scene.png);
    const candidates = diffRegions(bg.data, gen.data, 200, 100);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const { labels } = await backend.label({ game, scene, candidates, crops: [] });
    expect(labels.map((l) => l.objectId).sort()).toEqual(["a", "b"]);
    for (const l of labels) expect(l.confidence).toBe(1);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: `images.ts`**

```ts
/** The only module that touches sharp. Bytes in, bytes/RGBA out. */
import sharp from "sharp";
import type { ImageSize } from "@/lib/types";
import type { Box } from "./types";

export const DIFF_MAX_SIDE = 512;

export async function dimensions(png: Uint8Array): Promise<ImageSize> {
  const m = await sharp(png).metadata();
  if (!m.width || !m.height) throw new Error("images: cannot read dimensions");
  return { width: m.width, height: m.height };
}

export async function decodeRGBA(png: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

export function encodePng(rgba: Uint8Array, size: ImageSize): Promise<Uint8Array> {
  return sharp(Buffer.from(rgba), { raw: { width: size.width, height: size.height, channels: 4 } })
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b));
}

/** Longest side ≤ max, aspect preserved, at least 1px. */
export function diffScale(size: ImageSize, max = DIFF_MAX_SIDE): ImageSize {
  const f = Math.min(1, max / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * f)), height: Math.max(1, Math.round(size.height * f)) };
}

/** Resize (stretch to exactly `size`) and decode. Used to bring background and output onto one grid. */
export async function toRGBAAt(png: Uint8Array, size: ImageSize): Promise<Uint8Array> {
  const buf = await sharp(png).resize(size.width, size.height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  return new Uint8Array(buf);
}

/** Crop a normalized box out of a PNG (clamped to the frame). */
export async function cropPng(png: Uint8Array, box: Box, size: ImageSize): Promise<Uint8Array> {
  const left = Math.max(0, Math.floor(box.x * size.width));
  const top = Math.max(0, Math.floor(box.y * size.height));
  const width = Math.max(1, Math.min(size.width - left, Math.ceil(box.w * size.width)));
  const height = Math.max(1, Math.min(size.height - top, Math.ceil(box.h * size.height)));
  return new Uint8Array(await sharp(png).extract({ left, top, width, height }).png().toBuffer());
}

/** Paste `layers` onto `background` at their normalized boxes; each layer is resized to its box. */
export async function compositePng(background: Uint8Array, layers: readonly { png: Uint8Array; box: Box }[]): Promise<{ png: Uint8Array } & ImageSize> {
  const size = await dimensions(background);
  const inputs = await Promise.all(
    layers.map(async (l) => ({
      input: await sharp(l.png)
        .resize(Math.max(1, Math.round(l.box.w * size.width)), Math.max(1, Math.round(l.box.h * size.height)), { fit: "fill" })
        .png()
        .toBuffer(),
      left: Math.round(l.box.x * size.width),
      top: Math.round(l.box.y * size.height),
    })),
  );
  const png = new Uint8Array(await sharp(background).composite(inputs).png().toBuffer());
  return { png, ...size };
}
```

- [ ] **Step 5: `placement.ts`**

```ts
/** Deterministic, non-overlapping placement for paste mode. Pure. */
import type { ImageSize } from "@/lib/types";
import { overlapFraction } from "./boxes";
import { DEFAULT_SCALE } from "./prompt";
import type { Box } from "./types";

export type PlaceableObject = { readonly id: string; readonly requestedScale: number | null; /** sprite height / width */ readonly aspect: number };
export type PlacementOptions = { readonly margin: number; readonly gap: number; readonly maxTries: number };
export const PLACEMENT_DEFAULTS: PlacementOptions = { margin: 0.1, gap: 0.02, maxTries: 500 };

/** mulberry32 seeded from an FNV-1a hash of the string. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeObjects(objects: readonly PlaceableObject[], image: ImageSize, seed: string, opts: PlacementOptions = PLACEMENT_DEFAULTS): Box[] {
  const rand = seededRandom(seed);
  const placed: Box[] = [];
  for (const o of objects) {
    const w = o.requestedScale ?? DEFAULT_SCALE;
    const h = (w * o.aspect * image.width) / image.height;
    const maxX = 1 - opts.margin - w;
    const maxY = 1 - opts.margin - h;
    let box: Box | null = null;
    for (let t = 0; t < opts.maxTries && maxX >= opts.margin && maxY >= opts.margin; t++) {
      const cand = { x: opts.margin + rand() * (maxX - opts.margin), y: opts.margin + rand() * (maxY - opts.margin), w, h };
      const padded = { x: cand.x - opts.gap, y: cand.y - opts.gap, w: w + 2 * opts.gap, h: h + 2 * opts.gap };
      if (placed.every((p) => overlapFraction(padded, p) === 0)) {
        box = cand;
        break;
      }
    }
    if (!box) throw new Error(`placement: could not place object ${o.id} without overlap`);
    placed.push(box);
  }
  return placed;
}
```

- [ ] **Step 6: `backend.ts`**

```ts
/** The seam between the pipeline and any image/vision provider. */
import type { Candidate, ComposeResult, GameInput, VisionLabel } from "./types";

export type ComposeInput = GameInput & { readonly prompt: string };
export type LabelInput = {
  readonly game: GameInput;
  readonly scene: ComposeResult;
  readonly candidates: readonly Candidate[];
  /** PNG crops of each candidate, same order. */
  readonly crops: readonly Uint8Array[];
};
export type LabelResult = { readonly labels: readonly VisionLabel[]; readonly raw: unknown };

export interface GenerationBackend {
  readonly name: string;
  compose(input: ComposeInput): Promise<ComposeResult>;
  label(input: LabelInput): Promise<LabelResult>;
}

export type BackendSelection = { readonly ok: true; readonly backend: GenerationBackend } | { readonly ok: false; readonly reason: string };
```

`backendFromEnv` is added in Task 5 once the Gemini backend exists (it needs both).

- [ ] **Step 7: `paste.ts`**

```ts
/**
 * Deterministic compositor (SPEC §7 fallback). Same interface as Gemini; the diff →
 * validate path runs unchanged afterwards, so a validation failure in paste mode is a
 * pipeline bug, not a model quirk.
 */
import type { GenerationBackend } from "./backend";
import { overlapFraction } from "./boxes";
import { compositePng, dimensions } from "./images";
import { placeObjects } from "./placement";
import type { Box } from "./types";

export function createPasteBackend(): GenerationBackend {
  const placements = new Map<string, Map<string, Box>>(); // gameId → objectId → box
  return {
    name: "paste",
    async compose(input) {
      const size = await dimensions(input.background);
      const sprites = await Promise.all(input.objects.map(async (o) => ({ o, dims: await dimensions(o.image) })));
      const boxes = placeObjects(
        sprites.map(({ o, dims }) => ({ id: o.id, requestedScale: o.requestedScale, aspect: dims.height / dims.width })),
        size,
        input.id,
      );
      placements.set(input.id, new Map(sprites.map(({ o }, i) => [o.id, boxes[i]])));
      const layers = sprites.map(({ o }, i) => ({ png: o.image, box: boxes[i] }));
      return compositePng(input.background, layers);
    },
    async label({ game, candidates }) {
      const boxes = placements.get(game.id) ?? new Map<string, Box>();
      const labels = game.objects.flatMap((o) => {
        const box = boxes.get(o.id);
        if (!box) return [];
        let best = -1;
        let bestOverlap = 0;
        candidates.forEach((c, i) => {
          const f = overlapFraction(c, box);
          if (f > bestOverlap) {
            bestOverlap = f;
            best = i;
          }
        });
        return best === -1 ? [] : [{ candidate: best, objectId: o.id, confidence: 1 }];
      });
      return { labels, raw: { backend: "paste", placements: Object.fromEntries(boxes) } };
    },
  };
}
```

- [ ] **Step 8: Run tests, verify; commit**

Run: `npx vitest run src/lib/generation && npm run test:cov 2>&1 | tail -12 && npm run verify && npx knip`
Expected: green; `placement.ts` in coverage (it is not excluded) ≥ baseline; knip may list `createPasteBackend`/`images` exports as unused until Task 5 — acceptable only if `npx knip` still exits 0 (add `src/lib/generation/paste.ts` and `backend.ts` to `knip.json` entry temporarily if it does not, and note it).

```bash
git add src/lib/generation src/lib/storage.ts package.json package-lock.json knip.json
git commit -m "feat(generation): sharp image I/O, seeded placement, and the paste backend

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 5: Gemini backend and `attemptOnce`

**Owner:** the `image-pipeline` agent (this task carries API docs and real generations).

**Files:**
- Create: `src/lib/generation/gemini.ts`, `src/lib/generation/attempt.ts`
- Modify: `src/lib/generation/backend.ts` (add `backendFromEnv`), `package.json` (`@google/genai`), `.env.example` (`GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL`, `GENERATION_MODE`)
- Create (scratch, not committed): a smoke script under the scratchpad that runs `attemptOnce` with the Gemini backend on `src/db/seed/fixtures/background.png` + `object-1.png`.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `createGeminiBackend({ apiKey, imageModel, visionModel })`, `backendFromEnv(env = process.env): BackendSelection`, `attemptOnce(backend, game, adjustments): Promise<AttemptOutcome>` with
  ```ts
  export type AttemptOutcome = {
    readonly prompt: string;
    readonly image: ComposeResult;
    readonly candidates: readonly Candidate[];
    readonly labels: readonly VisionLabel[];
    readonly visionRaw: unknown;
    readonly result: ValidationResult;
    /** Accumulated adjustments to use for the NEXT attempt (input ones + new ones). */
    readonly adjustments: readonly Adjustment[];
    /** Only the adjustments added by this attempt's failures. */
    readonly added: readonly Adjustment[];
  };
  ```

- [ ] **Step 1: Install and env**

```bash
npm install @google/genai
```

`.env.example` — after `GEMINI_API_KEY=` add:

```
# Image model (Nano Banana family) and vision model used by the pipeline.
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_VISION_MODEL=gemini-3.1-flash
# gemini (default) | paste — paste composites deterministically without any API (CI uses it).
GENERATION_MODE=gemini
```

- [ ] **Step 2: `gemini.ts`**

Verify the current `@google/genai` call shapes with WebFetch on https://ai.google.dev/gemini-api/docs/image-generation and https://ai.google.dev/gemini-api/docs/structured-output before writing; adapt property names if the SDK differs, and record what you found in the report. Target shape:

```ts
/**
 * Gemini adapter. Compose: Nano Banana with the background + object images.
 * Label: a vision call constrained to JSON over the candidate crops only.
 */
import { GoogleGenAI, Type } from "@google/genai";
import type { GenerationBackend } from "./backend";
import { dimensions } from "./images";
import { parseLabels } from "./labels";

export type GeminiConfig = { readonly apiKey: string; readonly imageModel: string; readonly visionModel: string };
export const GEMINI_DEFAULTS = { imageModel: "gemini-3.1-flash-image", visionModel: "gemini-3.1-flash" } as const;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const png = (bytes: Uint8Array) => ({ inlineData: { mimeType: "image/png", data: b64(bytes) } });

export function createGeminiBackend(cfg: GeminiConfig): GenerationBackend {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    name: `gemini:${cfg.imageModel}`,
    async compose(input) {
      const parts = [
        { text: input.prompt },
        { text: "Background image:" },
        png(input.background),
        ...[...input.objects].sort((a, b) => a.sortOrder - b.sortOrder).flatMap((o, i) => [{ text: `Object ${i + 1} (${o.label}):` }, png(o.image)]),
      ];
      const res = await ai.models.generateContent({
        model: cfg.imageModel,
        contents: [{ role: "user", parts }],
        config: { responseModalities: ["IMAGE"] },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const data = part?.inlineData?.data;
      if (!data) throw new Error(`gemini: no image in response (${res.candidates?.[0]?.finishReason ?? "no candidate"})`);
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      // Nano Banana output is not dimensionally guaranteed: read what came back.
      const size = await dimensions(bytes);
      return { png: bytes, ...size };
    },
    async label({ game, scene, candidates, crops }) {
      const objectIds = game.objects.map((o) => o.id);
      const parts = [
        {
          text: [
            "You are labelling candidate regions of a generated hidden-object scene.",
            "First image: the whole scene. Then numbered candidate crops, then the reference images of the objects we placed, each with its id.",
            "For EVERY candidate, decide which object id it shows, or null if it shows none of them. Give a confidence in [0,1].",
            "Return a JSON array of {candidate, objectId, confidence}. Never invent regions.",
          ].join(" "),
        },
        { text: "Scene:" },
        png(scene.png),
        ...crops.flatMap((c, i) => [{ text: `Candidate ${i}:` }, png(c)]),
        ...game.objects.flatMap((o) => [{ text: `Object id="${o.id}" label="${o.label}":` }, png(o.image)]),
      ];
      const res = await ai.models.generateContent({
        model: cfg.visionModel,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                candidate: { type: Type.INTEGER },
                objectId: { type: Type.STRING, nullable: true },
                confidence: { type: Type.NUMBER },
              },
              required: ["candidate", "objectId", "confidence"],
            },
          },
        },
      });
      const text = res.text ?? "";
      return { labels: parseLabels(text, candidates.length, objectIds), raw: { model: cfg.visionModel, text } };
    },
  };
}
```

- [ ] **Step 3: `backendFromEnv` in `backend.ts`**

```ts
import { createGeminiBackend, GEMINI_DEFAULTS } from "./gemini";
import { createPasteBackend } from "./paste";

export function backendFromEnv(env: NodeJS.ProcessEnv = process.env): BackendSelection {
  const mode = env.GENERATION_MODE ?? "gemini";
  if (mode === "paste") return { ok: true, backend: createPasteBackend() };
  if (mode !== "gemini") return { ok: false, reason: `config: GENERATION_MODE must be gemini or paste, got "${mode}"` };
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "config: GEMINI_API_KEY not set" };
  return {
    ok: true,
    backend: createGeminiBackend({ apiKey, imageModel: env.GEMINI_IMAGE_MODEL ?? GEMINI_DEFAULTS.imageModel, visionModel: env.GEMINI_VISION_MODEL ?? GEMINI_DEFAULTS.visionModel }),
  };
}
```

(Keep the interface/type declarations from Task 4 in the same file, above this.)

- [ ] **Step 4: `attempt.ts`**

```ts
/** One attempt of the SPEC §5.3 pipeline, given a backend. Shared by run.ts and the eval. */
import type { GenerationBackend } from "./backend";
import { DIFF_DEFAULTS, diffRegions } from "./diff";
import { cropPng, diffScale, toRGBAAt } from "./images";
import { adjustmentFor, composePrompt, mergeAdjustments } from "./prompt";
import type { Adjustment, Candidate, ComposeResult, GameInput, ValidationResult, VisionLabel } from "./types";
import { validate } from "./validate";

export type AttemptOutcome = {
  readonly prompt: string;
  readonly image: ComposeResult;
  readonly candidates: readonly Candidate[];
  readonly labels: readonly VisionLabel[];
  readonly visionRaw: unknown;
  readonly result: ValidationResult;
  readonly adjustments: readonly Adjustment[];
  readonly added: readonly Adjustment[];
};

export async function attemptOnce(backend: GenerationBackend, game: GameInput, adjustments: readonly Adjustment[]): Promise<AttemptOutcome> {
  const prompt = composePrompt(game, game.objects, adjustments);
  const image = await backend.compose({ ...game, prompt });
  const size = { width: image.width, height: image.height };
  const small = diffScale(size);
  const [gen, bg] = await Promise.all([toRGBAAt(image.png, small), toRGBAAt(game.background, small)]);
  const candidates = diffRegions(bg, gen, small.width, small.height, { ...DIFF_DEFAULTS, maxCandidates: 2 * game.objects.length });

  let labels: readonly VisionLabel[] = [];
  let visionRaw: unknown = null;
  if (candidates.length > 0) {
    const crops = await Promise.all(candidates.map((c) => cropPng(image.png, c, size)));
    ({ labels, raw: visionRaw } = await backend.label({ game, scene: image, candidates, crops }));
  }

  const result = validate(game.objects, candidates, labels, size);
  const added = result.ok
    ? []
    : result.failures.flatMap((f) => {
        const a = adjustmentFor(f, game.objects.find((o) => o.id === f.objectId) ?? null);
        return a ? [a] : [];
      });
  return { prompt, image, candidates, labels, visionRaw, result, adjustments: mergeAdjustments(adjustments, added), added };
}
```

- [ ] **Step 5: Smoke test against the real API (bounded: ≤ 4 generations)**

Write a throwaway script in the scratchpad (not in the repo) that loads `.env.local` via `@next/env`, builds a `GameInput` from `src/db/seed/fixtures/background.png` + `object-1.png` (label "Red ball", prompt "on the floor, left side", requestedScale 0.1), calls `attemptOnce` with `backendFromEnv()`, and prints: output dims, candidate count, labels, `result`. Run it up to two times. Then run once with `GENERATION_MODE=paste` and confirm `result.ok === true`. Put the printed summaries (no base64, no full prompt) in the report. If the Gemini call fails on the request shape, fix `gemini.ts` per the docs and re-run.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify && npx knip`

```bash
git add src/lib/generation package.json package-lock.json .env.example knip.json
git commit -m "feat(generation): Gemini backend, backend selection, and attemptOnce

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 6: The loop — `run.ts`, `actions.ts`, integration tests

**Files:**
- Create: `src/lib/generation/run.ts`, `src/lib/generation/actions.ts`
- Test: `src/lib/generation/__tests__/run.integration.test.ts`
- Modify: `knip.json` (entry `src/lib/generation/actions.ts`)

**Interfaces:**
- Consumes: `setGeneratedImage` (`@/lib/games/games`), `isUuid` (`@/lib/games/validation`), `fail`/`ok`/`ActionResult` (`@/lib/games/result`), `objectKey`, `getObject`, `putObject` (`@/lib/storage`), `getCurrentUser`, `getDb`, `createTestDb`/`truncateAll` (`@/db/test`), `MAX_GENERATION_ATTEMPTS`, Tasks 1–5.
- Produces:
  ```ts
  export type RunDeps = { now(): Date; getObject(key: string): Promise<Uint8Array>; putObject(key: string, contentType: string, body: Uint8Array): Promise<void> };
  export async function startGeneration(db, user, gameId, now): Promise<ActionResult<{ runId: string; attemptNumber: number }>>;
  export async function loadGameInput(db, gameId, deps): Promise<GameInput | null>;
  export async function runGeneration(db, gameId, runId, selection: BackendSelection, deps): Promise<void>;
  export async function startGenerationAction(gameId: string): Promise<ActionResult<{ attemptNumber: number }>>;
  ```
  `generation_runs.vision_response` is written as `{ imageKey, width, height, candidates, labels, raw }` on every finished attempt (the evidence record), `failure_reason` via `formatFailures`, `adjustment` via `formatAdjustments(added)`.

- [ ] **Step 1: Failing integration tests**

`src/lib/generation/__tests__/run.integration.test.ts` (needs `TEST_DATABASE_URL`; run with `npm run test:integration`):

```ts
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test";
import { games, generationRuns, objects, users, type User } from "@/db/schema";
import { addObject, createGame, updateGame } from "@/lib/games/games";
import { MAX_GENERATION_ATTEMPTS, normalized } from "@/lib/types";
import type { GenerationBackend } from "../backend";
import { createPasteBackend } from "../paste";
import { runGeneration, startGeneration, type RunDeps } from "../run";

const { db, close } = createTestDb();
afterAll(close);

const FIX = (f: string) => new Uint8Array(readFileSync(`src/db/seed/fixtures/${f}`));
const store = new Map<string, Uint8Array>();
const deps: RunDeps = {
  now: () => new Date(),
  getObject: async (key) => {
    const v = store.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  },
  putObject: async (key, _ct, body) => {
    store.set(key, body);
  },
};

async function draft(master: User, objectCount = 2): Promise<string> {
  const g = await createGame(db, master, { title: "g", generalPrompt: "" });
  if (!g.ok) throw new Error(g.message);
  const bgKey = `games/${g.data.id}/background/bg.png`;
  store.set(bgKey, FIX("background.png"));
  await updateGame(db, master, g.data.id, { backgroundKey: bgKey });
  for (let i = 0; i < objectCount; i++) {
    const key = `games/${g.data.id}/object/o${i}.png`;
    store.set(key, FIX(`object-${i + 1}.png`));
    const o = await addObject(db, master, g.data.id, { label: `Object ${i}`, prompt: "", sourceImageKey: key, requestedScale: normalized(0.1) });
    if (!o.ok) throw new Error(o.message);
  }
  return g.data.id;
}

let master: User;
beforeEach(async () => {
  await truncateAll(db);
  store.clear();
  [master] = await db.insert(users).values({ id: "m1", email: "m1@test", name: "M" }).returning();
});

describe("startGeneration", () => {
  it("rejects a game without a background or objects, and a published game", async () => {
    const g = await createGame(db, master, { title: "g", generalPrompt: "" });
    if (!g.ok) throw new Error();
    expect((await startGeneration(db, master, g.data.id, new Date())).ok).toBe(false);
  });
  it("inserts a queued run with the composed prompt and refuses a second start while one is running", async () => {
    const id = await draft(master);
    const first = await startGeneration(db, master, id, new Date());
    expect(first.ok).toBe(true);
    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(row.status).toBe("queued");
    expect(row.attemptNumber).toBe(1);
    expect(row.promptUsed).toContain("Object 0");
    const second = await startGeneration(db, master, id, new Date());
    expect(second).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
  it("allows a new start when the previous run is stale", async () => {
    const id = await draft(master);
    const first = await startGeneration(db, master, id, new Date(Date.now() - 11 * 60_000));
    expect(first.ok).toBe(true);
    const second = await startGeneration(db, master, id, new Date());
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.attemptNumber).toBe(2);
  });
});

describe("runGeneration", () => {
  it("with the paste backend: passes on attempt 1, sets the image and unconfirmed positions, records the evidence", async () => {
    const id = await draft(master);
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: createPasteBackend() }, deps);

    const [run] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(run.status).toBe("passed");
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    const evidence = run.visionResponse as { imageKey: string; width: number; height: number; candidates: unknown[]; labels: unknown[] };
    expect(evidence.imageKey).toMatch(new RegExp(`^games/${id}/generated/`));
    expect(store.has(evidence.imageKey)).toBe(true);
    expect(evidence.candidates.length).toBeGreaterThanOrEqual(2);

    const [game] = await db.select().from(games).where(eq(games.id, id));
    expect(game.generatedImageKey).toBe(evidence.imageKey);
    expect(game.imageWidth).toBe(1024);
    expect(game.imageHeight).toBe(768);
    const objs = await db.select().from(objects).where(eq(objects.gameId, id));
    for (const o of objs) {
      expect(o.x).not.toBeNull();
      expect(o.radius).not.toBeNull();
      expect(o.confirmed).toBe(false);
    }
  });

  it("with a backend whose labels never match: three failed rows with reasons and adjustments, then stops; image untouched", async () => {
    const id = await draft(master);
    const paste = createPasteBackend();
    const silent: GenerationBackend = { name: "silent", compose: (i) => paste.compose(i), label: async () => ({ labels: [], raw: { silent: true } }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: silent }, deps);

    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id)).orderBy(generationRuns.attemptNumber);
    expect(runs.map((r) => r.status)).toEqual(Array(MAX_GENERATION_ATTEMPTS).fill("failed"));
    expect(runs[0].failureReason).toMatch(/^absent: Object 0 — /);
    expect(runs[0].adjustment).toContain("Place the Object 0");
    // attempt 2's prompt carries attempt 1's adjustment; attempt 3 adds nothing new (deduped)
    expect(runs[1].promptUsed).toContain("Adjustment: Place the Object 0");
    expect(runs[2].adjustment).toBeNull();
    const [game] = await db.select().from(games).where(eq(games.id, id));
    expect(game.generatedImageKey).toBeNull();
  });

  it("records a config failure when no backend is available", async () => {
    const id = await draft(master);
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: false, reason: "config: GEMINI_API_KEY not set" }, deps);
    const [run] = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(run.status).toBe("failed");
    expect(run.failureReason).toBe("config: GEMINI_API_KEY not set");
  });

  it("records a thrown backend error on the row and stops", async () => {
    const id = await draft(master);
    const boom: GenerationBackend = { name: "boom", compose: async () => { throw new Error("quota exceeded"); }, label: async () => ({ labels: [], raw: null }) };
    const started = await startGeneration(db, master, id, new Date());
    if (!started.ok) throw new Error(started.message);
    await runGeneration(db, id, started.data.runId, { ok: true, backend: boom }, deps);
    const runs = await db.select().from(generationRuns).where(eq(generationRuns.gameId, id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].failureReason).toBe("error: quota exceeded");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:integration -- src/lib/generation`

- [ ] **Step 3: `run.ts`**

```ts
/**
 * The generation loop (SPEC §5.3). Every attempt is a generation_runs row that exists
 * before the backend is called and is finalized on every path, thrown errors included —
 * this table is the project's autonomous-loop evidence.
 */
import { asc, eq, max } from "drizzle-orm";
import type { Database } from "@/db";
import { games, generationRuns, objects, type User } from "@/db/schema";
import { setGeneratedImage } from "@/lib/games/games";
import { fail, ok, type ActionResult } from "@/lib/games/result";
import { objectKey } from "@/lib/storage";
import { MAX_GENERATION_ATTEMPTS } from "@/lib/types";
import { attemptOnce } from "./attempt";
import type { BackendSelection } from "./backend";
import { composePrompt, formatAdjustments, formatFailures } from "./prompt";
import { deriveGenerationState } from "./status";
import type { Adjustment, GameInput } from "./types";

export type RunDeps = {
  now(): Date;
  getObject(key: string): Promise<Uint8Array>;
  putObject(key: string, contentType: string, body: Uint8Array): Promise<void>;
};

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function objectRows(db: Database | Tx, gameId: string) {
  return db.select().from(objects).where(eq(objects.gameId, gameId)).orderBy(asc(objects.sortOrder));
}

/** Owner + draft + inputs present + no live run; inserts the first attempt row under the game lock. */
export async function startGeneration(db: Database, user: User, gameId: string, now: Date): Promise<ActionResult<{ runId: string; attemptNumber: number }>> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
    if (!game || game.masterId !== user.id) return fail("NOT_FOUND", "Game not found");
    if (game.publishedAt !== null) return fail("NOT_DRAFT", "Only a draft can be generated");
    if (game.backgroundKey === null) return fail("INVALID_INPUT", "Upload a background first");
    const objs = await objectRows(tx, gameId);
    if (objs.length === 0) return fail("NO_OBJECTS", "Add at least one object");
    const runs = await tx.select().from(generationRuns).where(eq(generationRuns.gameId, gameId));
    if (deriveGenerationState(runs, now).kind === "running") return fail("INVALID_INPUT", "A generation is already running");
    const attemptNumber = (runs.reduce((m, r) => Math.max(m, r.attemptNumber), 0)) + 1;
    const [row] = await tx
      .insert(generationRuns)
      .values({ gameId, attemptNumber, status: "queued", promptUsed: composePrompt(game, objs, []), startedAt: now })
      .returning({ id: generationRuns.id });
    return ok({ runId: row.id, attemptNumber });
  });
}

export async function loadGameInput(db: Database, gameId: string, deps: RunDeps): Promise<GameInput | null> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.backgroundKey === null) return null;
  const objs = await objectRows(db, gameId);
  const [background, ...images] = await Promise.all([deps.getObject(game.backgroundKey), ...objs.map((o) => deps.getObject(o.sourceImageKey))]);
  return {
    id: game.id,
    title: game.title,
    generalPrompt: game.generalPrompt,
    background,
    objects: objs.map((o, i) => ({ id: o.id, label: o.label, prompt: o.prompt, requestedScale: o.requestedScale, sortOrder: o.sortOrder, image: images[i] })),
  };
}

type Finish = { status: "passed" | "failed"; failureReason?: string | null; adjustment?: string | null; visionResponse?: unknown };

async function finish(db: Database, runId: string, startedAt: Date, deps: RunDeps, f: Finish): Promise<void> {
  const now = deps.now();
  await db
    .update(generationRuns)
    .set({ status: f.status, failureReason: f.failureReason ?? null, adjustment: f.adjustment ?? null, visionResponse: f.visionResponse ?? null, finishedAt: now, durationMs: now.getTime() - startedAt.getTime() })
    .where(eq(generationRuns.id, runId));
}

export async function runGeneration(db: Database, gameId: string, firstRunId: string, selection: BackendSelection, deps: RunDeps): Promise<void> {
  let runId = firstRunId;
  let startedAt = deps.now();
  await db.update(generationRuns).set({ status: "running", startedAt }).where(eq(generationRuns.id, runId));

  if (!selection.ok) {
    await finish(db, runId, startedAt, deps, { status: "failed", failureReason: selection.reason });
    return;
  }
  const input = await loadGameInput(db, gameId, deps).catch((e: unknown) => {
    void e;
    return null;
  });
  if (!input) {
    await finish(db, runId, startedAt, deps, { status: "failed", failureReason: "error: could not load the game's images" });
    return;
  }

  let adjustments: readonly Adjustment[] = [];
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const [{ n }] = await db.select({ n: max(generationRuns.attemptNumber) }).from(generationRuns).where(eq(generationRuns.gameId, gameId));
      startedAt = deps.now();
      const [row] = await db
        .insert(generationRuns)
        .values({ gameId, attemptNumber: (n ?? 0) + 1, status: "running", promptUsed: composePrompt(input, input.objects, adjustments), startedAt })
        .returning({ id: generationRuns.id });
      runId = row.id;
    }
    try {
      const outcome = await attemptOnce(selection.backend, input, adjustments);
      const imageKey = objectKey("generated", gameId, "image/png");
      await deps.putObject(imageKey, "image/png", outcome.image.png);
      const evidence = { imageKey, width: outcome.image.width, height: outcome.image.height, candidates: outcome.candidates, labels: outcome.labels, raw: outcome.visionRaw };
      if (outcome.result.ok) {
        const set = await setGeneratedImage(db, gameId, { key: imageKey, width: outcome.image.width, height: outcome.image.height }, outcome.result.proposals);
        if (!set.ok) {
          await finish(db, runId, startedAt, deps, { status: "failed", failureReason: `error: ${set.message}`, visionResponse: evidence });
          return;
        }
        await finish(db, runId, startedAt, deps, { status: "passed", visionResponse: evidence });
        return;
      }
      await finish(db, runId, startedAt, deps, {
        status: "failed",
        failureReason: formatFailures(outcome.result.failures, input.objects),
        adjustment: formatAdjustments(outcome.added),
        visionResponse: evidence,
      });
      adjustments = outcome.adjustments;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      await finish(db, runId, startedAt, deps, { status: "failed", failureReason: `error: ${message}` });
      return; // an exception is not a prompt problem; retrying blindly would violate §5.3
    }
  }
}
```

The `promptUsed` of the queued row is composed with no adjustments — the first attempt's real prompt; later rows compose with the accumulated adjustments, so `prompt_used` is always exactly what was sent.

- [ ] **Step 4: `actions.ts`**

```ts
"use server";
/** Trigger for the generation loop. The loop itself runs after the response via `after()`. */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/games/result";
import { isUuid } from "@/lib/games/validation";
import { getObject, putObject } from "@/lib/storage";
import { backendFromEnv } from "./backend";
import { runGeneration, startGeneration } from "./run";

export async function startGenerationAction(gameId: string): Promise<ActionResult<{ attemptNumber: number }>> {
  if (!isUuid(gameId)) return fail("NOT_FOUND", "Game not found");
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Sign in first");
  const started = await startGeneration(getDb(), user, gameId, new Date());
  if (!started.ok) return started;
  after(async () => {
    await runGeneration(getDb(), gameId, started.data.runId, backendFromEnv(), { now: () => new Date(), getObject, putObject });
    revalidatePath(`/games/${gameId}`);
  });
  revalidatePath(`/games/${gameId}`);
  return ok({ attemptNumber: started.data.attemptNumber });
}
```

- [ ] **Step 5: Run integration + verify; commit**

Run: `npm run test:integration -- src/lib/generation && npm run verify && npx knip`
Expected: the five integration tests pass (paste on the 1024×768 fixture must pass validation on attempt 1 — if it does not, the failing class tells you which threshold to inspect; do not loosen SPEC thresholds, fix placement instead).

```bash
git add src/lib/generation knip.json
git commit -m "feat(generation): persisted retry loop, start guard, and the server action

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 7: Master Generation panel, E2E, CI

**Files:**
- Create: `src/app/(master)/games/[id]/generation-panel.tsx`, `e2e/generate.spec.ts`
- Modify: `src/app/(master)/games/[id]/page.tsx` (section + `maxDuration`), `playwright.config.ts` (webServer env), `.github/workflows/ci.yml` (`GENERATION_MODE: paste` in the `e2e` job env)

**Interfaces:**
- Consumes: `startGenerationAction`, `deriveGenerationState` (Task 2), `MasterGameView.generationRuns`, canvas test ids (`marker`, `object-chip`), Phase 1 pages (`/games/new`, upload fields, add-object form, window fields, Publish).
- Produces: DOM — `data-testid="generate"` button, `data-testid="generation-state"` (text `idle|running|passed|failed`), `data-testid="generation-run"` rows.

- [ ] **Step 1: Panel**

`src/app/(master)/games/[id]/generation-panel.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { startGenerationAction } from "@/lib/generation/actions";
import type { GenerationState } from "@/lib/generation/status";
import type { GenerationRunView } from "@/lib/types";

const POLL_MS = 3000;

/** SPEC §3.1.4–5: generate, watch the loop, read why it failed. Positions are confirmed on the canvas above. */
export function GenerationPanel({ gameId, state, runs, canGenerate }: { gameId: string; state: GenerationState; runs: readonly GenerationRunView[]; canGenerate: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const running = state.kind === "running";

  // Poll while the loop runs. No state is set here; the server re-renders the page.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [running, router]);

  function generate() {
    start(async () => {
      setError(null);
      const r = await startGenerationAction(gameId);
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button data-testid="generate" onClick={generate} disabled={!canGenerate || running || pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-40">
          {runs.length === 0 ? "Generate" : "Generate again"}
        </button>
        <span data-testid="generation-state" className="text-sm text-neutral-600">
          {state.kind}
          {state.kind === "running" && ` — attempt ${state.attemptNumber}…`}
          {state.kind === "failed" && ` after ${state.attempts} attempt${state.attempts === 1 ? "" : "s"}`}
        </span>
      </div>
      {state.kind === "failed" && (
        <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          {state.reason}
          <br />
          Edit the prompts above and generate again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {runs.length > 0 && (
        <ol className="divide-y text-sm">
          {[...runs]
            .sort((a, b) => b.attemptNumber - a.attemptNumber)
            .map((r) => (
              <li key={r.attemptNumber} data-testid="generation-run" data-status={r.status} className="flex flex-col gap-1 py-2">
                <div className="flex gap-3">
                  <span className="font-medium">#{r.attemptNumber}</span>
                  <span>{r.status}</span>
                  <span className="text-neutral-500">{r.startedAt.toISOString().slice(11, 19)} UTC</span>
                </div>
                {r.failureReason && <pre className="whitespace-pre-wrap text-xs text-neutral-700">{r.failureReason}</pre>}
                {r.adjustment && <pre className="whitespace-pre-wrap text-xs text-neutral-500">→ {r.adjustment}</pre>}
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Page wiring**

In `src/app/(master)/games/[id]/page.tsx`: add `export const maxDuration = 300;` next to the imports (server actions from this page — the generation loop — may run up to 5 minutes); import `deriveGenerationState` and `GenerationPanel`; compute `const generation = deriveGenerationState(game.generationRuns, new Date());`; insert this section between Background and Positions:

```tsx
      {editable && (
        <section>
          <h2 className="mb-2 font-medium">Generation</h2>
          <GenerationPanel gameId={id} state={generation} runs={game.generationRuns} canGenerate={game.backgroundUrl !== null && game.objects.length > 0} />
        </section>
      )}
```

- [ ] **Step 3: E2E**

`playwright.config.ts` webServer: add `env: { GENERATION_MODE: "paste" }` (Playwright merges it over `process.env`), with a comment: E2E never calls Gemini; locally with `reuseExistingServer` an already-running dev server keeps its own mode — start the suite with no dev server running when exercising `generate.spec.ts`.

`e2e/generate.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const FIX = "src/db/seed/fixtures";

/** SPEC §8: a master goes from upload to published without touching a coordinate value. */
test("upload → generate → confirm → publish", async ({ page }) => {
  await page.goto("/games/new");
  await page.getByLabel(/title/i).fill("[e2e] generated game");
  await page.getByLabel(/prompt/i).fill("A plain test scene.");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/);

  await page.getByLabel("Upload background").setInputFiles(`${FIX}/background.png`);
  await expect(page.locator("img[alt='']").first()).toBeVisible();

  for (const [i, label] of ["Red ball", "Green box"].entries()) {
    await page.getByLabel(/^label/i).fill(label);
    await page.getByLabel("Object image").setInputFiles(`${FIX}/object-${i + 1}.png`);
    const add = page.getByRole("button", { name: /add object/i });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  await page.getByTestId("generate").click();
  await expect(page.getByTestId("generation-state")).toHaveText(/passed/, { timeout: 60_000 });
  await expect(page.getByTestId("generation-run")).toHaveCount(1);
  await expect(page.getByTestId("marker-canvas")).toHaveAttribute("data-mode", "author");
  await expect(page.getByTestId("marker")).toHaveCount(2);
  await expect(page.getByText("unconfirmed", { exact: true })).toHaveCount(2);

  for (let i = 0; i < 2; i++) {
    const next = page.getByRole("button", { name: "Confirm", exact: true }).and(page.locator(":enabled")).first();
    await next.click();
    await expect(page.getByText("unconfirmed", { exact: true })).toHaveCount(1 - i);
  }

  await page.getByLabel("Starts").fill("2030-01-01T10:00");
  await page.getByLabel("Ends").fill("2030-01-02T10:00");
  await page.getByRole("button", { name: /save window/i }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("scheduled", { exact: true })).toBeVisible();
});
```

Adjust selectors to the real DOM (the `/games/new` form labels, the add-object button text, the Confirm buttons) as Task 7 of Phase 3 did — fix the spec, not the app, except for a missing `data-testid`.

CI: in `.github/workflows/ci.yml` `e2e` job `Run Playwright` env add `GENERATION_MODE: paste`.

- [ ] **Step 4: Run E2E locally (no dev server running), verify; commit**

Run: `npm run test:e2e` (8 tests) then `npm run verify && npx knip`

```bash
git add "src/app/(master)/games/[id]" e2e playwright.config.ts .github/workflows/ci.yml
git commit -m "feat(master): generation panel with polling; E2E upload→generate→publish in paste mode

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

### Task 8: Golden set and eval

**Owner:** the `image-pipeline` agent.

**Files:**
- Create: `evals/generation/make-golden.ts`, `evals/generation/eval.ts`, `evals/generation/golden/<case>/{background.png, objects/*.png, case.json}` (5 cases), `evals/generation/README.md`
- Modify: `package.json` (`eval:generation`, `eval:make-golden`), `knip.json` (`evals/**/*.ts` in entry and project), `tsconfig.json` only if `evals/` is not already included by `**/*.ts` (it is).

**Interfaces:**
- Consumes: `attemptOnce`, `backendFromEnv`, `createPasteBackend`, `formatFailures`, `MAX_GENERATION_ATTEMPTS`.
- Produces: `npm run eval:generation [-- --backend gemini|paste] [--threshold 0.8]` → per-case lines + pass rate; exit 1 below threshold.

- [ ] **Step 1: `case.json` shape and README**

```json
{
  "title": "Kitchen counter",
  "generalPrompt": "A bright cartoon kitchen, mid difficulty.",
  "objects": [
    { "file": "objects/mug.png", "label": "Coffee mug", "prompt": "on the counter near the kettle", "requestedScale": 0.1 },
    { "file": "objects/duck.png", "label": "Rubber duck", "prompt": "on the windowsill", "requestedScale": 0.08 }
  ]
}
```

README: what the golden set is, how it was made, how to run the eval, that it costs money and never runs in CI.

- [ ] **Step 2: `make-golden.ts`** (one-off; uses `GEMINI_API_KEY`; text-to-image via `ai.models.generateContent` with `responseModalities: ["IMAGE"]`, 1024-ish output). Five scene prompts (kitchen, park bench, desk, beach, workshop) and ten object prompts ("a single red coffee mug, centered, on a plain white background, no shadow", …), two or three objects per case. Writes the folders above. Run it once; commit the PNGs (keep each ≤ 1.5 MB; downscale with sharp to 1024 on the long side).

- [ ] **Step 3: `eval.ts`**

```ts
/** Runs the pipeline on the golden set and reports a pass rate. On demand only; never CI. */
import { loadEnvConfig } from "@next/env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { attemptOnce } from "@/lib/generation/attempt";
import { backendFromEnv, type GenerationBackend } from "@/lib/generation/backend";
import { createPasteBackend } from "@/lib/generation/paste";
import { formatFailures } from "@/lib/generation/prompt";
import type { Adjustment, GameInput } from "@/lib/generation/types";
import { MAX_GENERATION_ATTEMPTS } from "@/lib/types";

loadEnvConfig(process.cwd());

const args = new Map(process.argv.slice(2).map((a, i, all) => [a, all[i + 1]] as const));
const mode = args.get("--backend") ?? "gemini";
const threshold = Number(args.get("--threshold") ?? "0.8");
const root = join(process.cwd(), "evals/generation/golden");

function loadCase(dir: string): GameInput {
  const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as { title: string; generalPrompt: string; objects: { file: string; label: string; prompt: string; requestedScale: number | null }[] };
  return {
    id: dir,
    title: spec.title,
    generalPrompt: spec.generalPrompt,
    background: new Uint8Array(readFileSync(join(dir, "background.png"))),
    objects: spec.objects.map((o, i) => ({ id: `o${i}`, label: o.label, prompt: o.prompt, requestedScale: o.requestedScale, sortOrder: i, image: new Uint8Array(readFileSync(join(dir, o.file))) })),
  };
}

async function runCase(backend: GenerationBackend, game: GameInput): Promise<{ passed: boolean; attempts: number; last: string }> {
  let adjustments: readonly Adjustment[] = [];
  let last = "";
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const out = await attemptOnce(backend, game, adjustments);
    if (out.result.ok) return { passed: true, attempts: attempt, last: "pass" };
    last = formatFailures(out.result.failures, game.objects).replaceAll("\n", "; ");
    adjustments = out.adjustments;
  }
  return { passed: false, attempts: MAX_GENERATION_ATTEMPTS, last };
}

async function main(): Promise<void> {
  const selection = mode === "paste" ? { ok: true as const, backend: createPasteBackend() } : backendFromEnv();
  if (!selection.ok) throw new Error(selection.reason);
  const cases = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name));
  let passed = 0;
  for (const dir of cases) {
    const r = await runCase(selection.backend, loadCase(dir));
    passed += r.passed ? 1 : 0;
    console.log(`${r.passed ? "PASS" : "FAIL"}  ${dir.split("/").at(-1)}  attempts=${r.attempts}  ${r.last}`);
  }
  const rate = cases.length === 0 ? 0 : passed / cases.length;
  console.log(`\n${passed}/${cases.length} passed (${(rate * 100).toFixed(0)}%) with backend=${selection.backend.name}; threshold ${threshold * 100}%`);
  if (rate < threshold) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
```

Scripts: `"eval:generation": "tsx evals/generation/eval.ts"`, `"eval:make-golden": "tsx evals/generation/make-golden.ts"`.

- [ ] **Step 4: Run both backends**

Run: `npm run eval:generation -- --backend paste` (expect 5/5) and `npm run eval:generation` (real Gemini, ≤ 15 generations). Record per-case lines and the pass rate in the report — this is the number the handoff quotes. If Gemini is below 80 %, tune prompts (`prompt.ts`) or `DIFF_DEFAULTS` — never the SPEC thresholds — and re-run once; report both runs.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify && npx knip`

```bash
git add evals package.json knip.json
git commit -m "feat(eval): golden set and generation eval harness

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TUzC26TE27G3MGEiMwcB"
```

---

## Self-review

**Spec coverage:** loop + persistence + cap + adjustments → T6 (+T2 table); job runner `after()` → T6 actions + T7 `maxDuration`; pixel diff → T3; vision constrained to candidates + JSON → T5; validation predicate → T1; paste full stand-in → T4 (+T6 integration, T7 E2E); master UI + polling → T7; eval + golden set → T8; config/env → T5/T7; stale rule → T2/T6. SPEC §8 "generation failure surfaces a specific, actionable reason" → T2 `formatFailures` + T7 panel; "recorded loop in `generation_runs` shows failure, adjustment, and recovery" → T6 evidence shape + T8 real run (dev-log at close-out).

**Type consistency:** `Candidate`/`VisionLabel`/`Proposal`/`Failure`/`Adjustment` (T1) used unchanged in T2–T6; `GenerationBackend.compose/label` signatures identical in T4 (paste), T5 (gemini, attempt), T6 (tests); `AttemptOutcome.added` consumed by T6's `formatAdjustments(outcome.added)`; `RunDeps` shape identical in T6 tests and actions; `deriveGenerationState` `RunLike` is satisfied by both DB rows (T6) and `GenerationRunView` (T7); `startGeneration` returns `{ runId, attemptNumber }`, action returns `{ attemptNumber }`.

**Placeholders:** none. Golden-set image content is produced by the committed script, not hand-waved.
