"use client";
import { useState, useSyncExternalStore } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fromLocalInputValue, toLocalInputValue } from "./window-time";

const noop = () => () => {};
/** false during SSR and hydration, true after — no setState, no effect. */
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

/**
 * datetime-local is wall-clock time in the browser's zone. The hidden inputs carry the
 * UTC ISO instant — the display boundary — so the server only ever sees UTC (invariant 6).
 *
 * Server render and the first client render both produce empty fields (no zone-specific
 * value yet), so SSR and hydration agree. Once mounted in the browser, `Inner` remounts
 * keyed on that and computes its initial value from the browser's zone.
 */
export function WindowFields({
  startsAt,
  endsAt,
  disabled,
}: {
  startsAt: string | null;
  endsAt: string | null;
  disabled: boolean;
}) {
  const isClient = useIsClient();
  return <Inner key={isClient ? "client" : "server"} startsAt={startsAt} endsAt={endsAt} disabled={disabled} local={isClient} />;
}

function Inner({
  startsAt,
  endsAt,
  disabled,
  local,
}: {
  startsAt: string | null;
  endsAt: string | null;
  disabled: boolean;
  local: boolean;
}) {
  const initial = (iso: string | null) => (local && iso ? toLocalInputValue(new Date(iso)) : "");
  const [start, setStart] = useState(() => initial(startsAt));
  const [end, setEnd] = useState(() => initial(endsAt));
  const iso = (v: string) => (v ? fromLocalInputValue(v) : "");
  return (
    <div className="flex flex-wrap gap-4">
      <div className="grid gap-2">
        <Label htmlFor="startsAt-local">Starts</Label>
        <Input
          id="startsAt-local"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="endsAt-local">Ends</Label>
        <Input
          id="endsAt-local"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <p className="basis-full text-xs text-muted-foreground">Times are in your local zone; players everywhere see the same instant.</p>
      <input type="hidden" name="startsAt" value={iso(start)} />
      <input type="hidden" name="endsAt" value={iso(end)} />
    </div>
  );
}
