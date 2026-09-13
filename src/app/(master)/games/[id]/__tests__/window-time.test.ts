import { describe, expect, it } from "vitest";
import { fromLocalInputValue, toLocalInputValue } from "../window-time";

describe("toLocalInputValue", () => {
  it("formats a Date using local getters, zero-padded", () => {
    const date = new Date(2026, 8, 13, 9, 5); // 2026-09-13 09:05 local
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    expect(toLocalInputValue(date)).toBe(expected);
  });

  it("zero-pads single-digit month, day, hour, and minute", () => {
    const date = new Date(2026, 0, 2, 3, 4); // 2026-01-02 03:04 local
    expect(toLocalInputValue(date)).toBe("2026-01-02T03:04");
  });
});

describe("fromLocalInputValue", () => {
  it("interprets the value as local wall time and returns a UTC ISO instant", () => {
    const iso = fromLocalInputValue("2026-09-13T09:05");
    expect(iso).toBe(new Date("2026-09-13T09:05").toISOString());
    expect(iso.endsWith("Z")).toBe(true);
  });

  it("round-trips with toLocalInputValue back to the same local wall-clock fields", () => {
    const date = new Date(2026, 0, 1, 0, 30);
    const local = toLocalInputValue(date);
    const roundTripped = new Date(fromLocalInputValue(local));
    expect(roundTripped.getFullYear()).toBe(date.getFullYear());
    expect(roundTripped.getMonth()).toBe(date.getMonth());
    expect(roundTripped.getDate()).toBe(date.getDate());
    expect(roundTripped.getHours()).toBe(date.getHours());
    expect(roundTripped.getMinutes()).toBe(date.getMinutes());
  });
});
