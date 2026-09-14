import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_CAP, dailyCapFromEnv } from "../run";

describe("dailyCapFromEnv", () => {
  it("falls back to DEFAULT_DAILY_CAP when unset", () => {
    expect(dailyCapFromEnv({})).toBe(DEFAULT_DAILY_CAP);
  });

  it("falls back to DEFAULT_DAILY_CAP for a non-integer or non-positive value", () => {
    expect(dailyCapFromEnv({ GENERATION_DAILY_CAP: "banana" })).toBe(DEFAULT_DAILY_CAP);
    expect(dailyCapFromEnv({ GENERATION_DAILY_CAP: "0" })).toBe(DEFAULT_DAILY_CAP);
    expect(dailyCapFromEnv({ GENERATION_DAILY_CAP: "-5" })).toBe(DEFAULT_DAILY_CAP);
    expect(dailyCapFromEnv({ GENERATION_DAILY_CAP: "1.5" })).toBe(DEFAULT_DAILY_CAP);
  });

  it("uses the configured cap when it is a positive integer", () => {
    expect(dailyCapFromEnv({ GENERATION_DAILY_CAP: "5" })).toBe(5);
  });
});
