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

function trailingFailures(sorted: readonly RunLike[], fromIndex: number): number {
  let count = 0;
  for (let i = fromIndex; i >= 0 && sorted[i].status === "failed"; i--) count++;
  return count;
}

export function deriveGenerationState(runs: readonly RunLike[], now: Date): GenerationState {
  const sorted = [...runs].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const latest = sorted.at(-1);
  if (!latest) return { kind: "idle" };
  if (latest.status === "running" || latest.status === "queued") {
    if (now.getTime() - latest.startedAt.getTime() > STALE_AFTER_MS) {
      return { kind: "failed", attemptNumber: latest.attemptNumber, reason: STALE_REASON, attempts: 1 + trailingFailures(sorted, sorted.length - 2) };
    }
    return { kind: "running", attemptNumber: latest.attemptNumber, startedAt: latest.startedAt };
  }
  if (latest.status === "passed") return { kind: "passed", attemptNumber: latest.attemptNumber, finishedAt: latest.finishedAt };
  return { kind: "failed", attemptNumber: latest.attemptNumber, reason: latest.failureReason ?? "unknown", attempts: 1 + trailingFailures(sorted, sorted.length - 2) };
}
