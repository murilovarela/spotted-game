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
