import { describe, expect, it } from "vitest";
import { formatLocalRange } from "../local-time";

describe("formatLocalRange", () => {
  it("renders both ends in the given zone, same day collapsed", () => {
    const s = formatLocalRange("2026-09-20T13:00:00.000Z", "2026-09-20T15:30:00.000Z", "en-US", "America/Sao_Paulo");
    expect(s).toBe("Sep 20, 10:00 AM – 12:30 PM");
  });
  it("shows both dates when the window spans days", () => {
    const s = formatLocalRange("2026-09-20T23:00:00.000Z", "2026-09-22T01:00:00.000Z", "en-US", "UTC");
    expect(s).toBe("Sep 20, 11:00 PM – Sep 22, 1:00 AM");
  });
  it("reports an unset window", () => {
    expect(formatLocalRange(null, null, "en-US", "UTC")).toBe("No window yet");
    expect(formatLocalRange("2026-09-20T13:00:00.000Z", null, "en-US", "UTC")).toBe("No window yet");
  });
});
