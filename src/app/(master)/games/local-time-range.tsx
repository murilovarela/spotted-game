"use client";
import { useSyncExternalStore } from "react";
import { formatLocalRange } from "./local-time";

const noop = () => () => {};
/** SSR and the first client render agree on "…" (no zone yet); the browser's zone lands after hydration. */
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

export function LocalTimeRange({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const isClient = useIsClient();
  if (!isClient) return <span aria-hidden>…</span>;
  return <span>{formatLocalRange(startsAt, endsAt, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>;
}
