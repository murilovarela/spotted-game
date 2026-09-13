"use client";
import { useState } from "react";
import { fromLocalInputValue, toLocalInputValue } from "./window-time";

/**
 * datetime-local is wall-clock time in the browser's zone. The hidden inputs carry the
 * UTC ISO instant — the display boundary — so the server only ever sees UTC (invariant 6).
 */
export function WindowFields({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const toLocal = (iso: string | null) => (iso ? toLocalInputValue(new Date(iso)) : "");
  const [start, setStart] = useState(toLocal(startsAt));
  const [end, setEnd] = useState(toLocal(endsAt));
  const iso = (local: string) => (local ? fromLocalInputValue(local) : "");
  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1">
        Starts
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border p-2" required />
      </label>
      <label className="flex flex-col gap-1">
        Ends
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border p-2" required />
      </label>
      <input type="hidden" name="startsAt" value={iso(start)} />
      <input type="hidden" name="endsAt" value={iso(end)} />
    </div>
  );
}
