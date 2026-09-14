/** `m:ss.t` — minutes unbounded, tenths of a second. Display only. */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenths = Math.floor(safe / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenth}`;
}
