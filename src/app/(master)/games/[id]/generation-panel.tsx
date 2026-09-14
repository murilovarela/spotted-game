"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { startGenerationAction } from "@/lib/generation/actions";
import type { GenerationState } from "@/lib/generation/status";
import type { GenerationRunView } from "@/lib/types";

const POLL_MS = 3000;

/** SPEC §3.1.4–5: generate, watch the loop, read why it failed. Positions are confirmed on the canvas above. */
export function GenerationPanel({
  gameId,
  state,
  runs,
  canGenerate,
}: {
  gameId: string;
  state: GenerationState;
  runs: readonly GenerationRunView[];
  canGenerate: boolean;
}) {
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
        <button
          type="button"
          data-testid="generate"
          onClick={generate}
          disabled={!canGenerate || running || pending}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-40"
        >
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
