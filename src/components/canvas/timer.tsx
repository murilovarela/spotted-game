"use client";
/**
 * Display-only clock. `startedAt` and `serverNow` both come from the server; the device
 * clock is used only to advance the display between renders, offset-corrected so a
 * skewed client shows the same elapsed time the server will record (invariant 5).
 */
import { useState, useSyncExternalStore } from "react";
import { formatElapsed } from "./format";

export function Timer({ startedAtMs, serverNowMs }: { startedAtMs: number; serverNowMs: number }) {
  // One store per mount. The snapshot is a cached number that changes only on the
  // interval tick, and the three functions keep a stable identity — both are
  // requirements of useSyncExternalStore (a live getSnapshot re-renders forever).
  const [store] = useState(() => {
    const state = { offset: serverNowMs - Date.now(), now: serverNowMs };
    return {
      subscribe(onChange: () => void): () => void {
        const id = setInterval(() => {
          state.now = Date.now() + state.offset;
          onChange();
        }, 100);
        return () => clearInterval(id);
      },
      getSnapshot: () => state.now,
      getServerSnapshot: () => serverNowMs, // identical markup on both sides of hydration
    };
  });
  const now = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return (
    <span data-testid="timer" className="font-mono text-2xl tabular-nums" aria-live="off">
      {formatElapsed(now - startedAtMs)}
    </span>
  );
}
