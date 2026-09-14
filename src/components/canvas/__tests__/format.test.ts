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
