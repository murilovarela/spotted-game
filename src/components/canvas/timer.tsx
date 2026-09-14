"use client";
/**
 * Display-only clock. `startedAt` and `serverNow` both come from the server; the device
 * clock is used only to advance the display between renders, offset-corrected so a
 * skewed client shows the same elapsed time the server will record (invariant 5).
 */
import { useState, useSyncExternalStore } from "react";
import { formatElapsed } from "./format";

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 100);
  return () => clearInterval(id);
}

export function Timer({ startedAtMs, serverNowMs }: { startedAtMs: number; serverNowMs: number }) {
  const [offset] = useState(() => serverNowMs - Date.now());
  const now = useSyncExternalStore(
    subscribe,
    () => Date.now() + offset,
    () => serverNowMs, // server snapshot: identical markup on both sides of hydration
  );
  return (
    <span data-testid="timer" className="font-mono text-2xl tabular-nums" aria-live="off">
      {formatElapsed(now - startedAtMs)}
    </span>
  );
}
