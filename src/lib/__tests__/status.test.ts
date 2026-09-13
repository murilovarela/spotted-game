import { describe, expect, it } from "vitest";
import { deriveStatus } from "../status";

const startsAt = new Date("2026-09-13T10:00:00Z");
const endsAt = new Date("2026-09-13T11:00:00Z");
const publishedAt = new Date("2026-09-12T10:00:00Z");
const published = { startsAt, endsAt, publishedAt };
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

describe("deriveStatus", () => {
  it("is draft while unpublished, whatever the window says", () => {
    expect(deriveStatus({ ...published, publishedAt: null }, ms(startsAt, 1))).toBe("draft");
    expect(deriveStatus({ startsAt: null, endsAt: null, publishedAt: null }, startsAt)).toBe("draft");
  });

  it("is scheduled before starts_at", () => {
    expect(deriveStatus(published, ms(startsAt, -1))).toBe("scheduled");
    expect(deriveStatus(published, publishedAt)).toBe("scheduled");
  });

  it("becomes active exactly at starts_at (inclusive)", () => {
    expect(deriveStatus(published, startsAt)).toBe("active");
    expect(deriveStatus(published, ms(startsAt, 1))).toBe("active");
  });

  it("stays active until ends_at (exclusive)", () => {
    expect(deriveStatus(published, ms(endsAt, -1))).toBe("active");
  });

  it("becomes finished exactly at ends_at (inclusive)", () => {
    expect(deriveStatus(published, endsAt)).toBe("finished");
    expect(deriveStatus(published, ms(endsAt, 1))).toBe("finished");
  });

  it("does not depend on the Date's time zone representation", () => {
    // Same instant, different string form.
    const nowLocal = new Date(startsAt.getTime());
    expect(deriveStatus(published, nowLocal)).toBe("active");
  });

  it("throws on a published game without a window (a DB-forbidden state)", () => {
    expect(() => deriveStatus({ startsAt: null, endsAt, publishedAt }, startsAt)).toThrow();
  });
});
