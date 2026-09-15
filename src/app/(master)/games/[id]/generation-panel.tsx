"use client";
import { CheckCircle2, Clock, Loader2, Sparkles, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startGenerationAction } from "@/lib/generation/actions";
import type { GenerationState } from "@/lib/generation/status";
import type { GenerationRunView } from "@/lib/types";

const POLL_MS = 3000;

const STATUS_ICON: Record<GenerationRunView["status"], React.ReactNode> = {
  queued: <Clock className="size-4 text-muted-foreground" aria-hidden />,
  running: <Loader2 className="size-4 animate-spin text-primary" aria-hidden />,
  passed: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  failed: <XCircle className="size-4 text-destructive" aria-hidden />,
};

/** What the master can do about a failure: prompts fix model failures, not config or runtime ones. */
function nextStep(reason: string): string {
  if (reason.startsWith("config:")) return "Check the server configuration (GEMINI_API_KEY / GENERATION_MODE).";
  if (reason.startsWith("error:") || reason.startsWith("stale")) return "Try again; if it keeps failing, check the server logs.";
  return "Edit the prompts above and generate again.";
}

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="generate" onClick={generate} disabled={!canGenerate || running || pending} size="lg">
          {running || pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {runs.length === 0 ? "Generate" : "Generate again"}
        </Button>
        <span data-testid="generation-state" className="text-sm text-muted-foreground">
          {state.kind}
          {state.kind === "running" && ` — attempt ${state.attemptNumber}…`}
          {state.kind === "failed" && ` after ${state.attempts} attempt${state.attempts === 1 ? "" : "s"}`}
        </span>
        {!canGenerate && !running && <span className="text-sm text-muted-foreground">Needs a background and at least one object.</span>}
      </div>
      {state.kind === "failed" && (
        <Alert role="alert">
          <AlertTitle>Generation did not pass</AlertTitle>
          <AlertDescription>
            <p>{state.reason}</p>
            <p>{nextStep(state.reason)}</p>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {runs.length > 0 && (
        <ol className="relative flex flex-col gap-3 border-l pl-5 text-sm">
          {[...runs].sort((a, b) => b.attemptNumber - a.attemptNumber).map((r) => (
            <li key={r.attemptNumber} data-testid="generation-run" data-status={r.status} className="relative flex flex-col gap-1">
              <span className="absolute -left-[1.6rem] top-0.5 grid size-5 place-items-center rounded-full bg-background">{STATUS_ICON[r.status]}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Attempt {r.attemptNumber}</span>
                <Badge variant="secondary">{r.status}</Badge>
                <span className="text-muted-foreground">{r.startedAt.toISOString().slice(11, 19)} UTC{r.finishedAt && ` · ${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)} s`}</span>
              </div>
              {r.failureReason && <pre className="whitespace-pre-wrap font-sans text-xs text-foreground/80">{r.failureReason}</pre>}
              {r.adjustment && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Prompt adjustment</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{r.adjustment}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
