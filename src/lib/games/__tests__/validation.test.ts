import { describe, expect, it } from "vitest";
import {
  isUuid,
  isValidScale,
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

  it("rejects a non-string value at runtime rather than throwing (a server action's argument crosses an untyped boundary)", () => {
    expect(validateTitle(42 as unknown as string)).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(validateLabel(null as unknown as string)).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(validatePrompt(undefined as unknown as string)).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(validateTitle({} as unknown as string)).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("isValidScale", () => {
  it("accepts a finite number in (0, 1]", () => {
    expect(isValidScale(0.5)).toBe(true);
    expect(isValidScale(1)).toBe(true);
  });
  it("rejects 0, negatives, values above 1, non-finite numbers, and non-numbers", () => {
    expect(isValidScale(0)).toBe(false);
    expect(isValidScale(-0.1)).toBe(false);
    expect(isValidScale(1.1)).toBe(false);
    expect(isValidScale(Number.NaN)).toBe(false);
    expect(isValidScale(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidScale("0.5")).toBe(false);
    expect(isValidScale(null)).toBe(false);
    expect(isValidScale(undefined)).toBe(false);
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

describe("isUuid", () => {
  it("accepts a valid v4 uuid, case-insensitively", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111".toUpperCase())).toBe(true);
  });
  it("rejects a 35-char string and an empty string", () => {
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
