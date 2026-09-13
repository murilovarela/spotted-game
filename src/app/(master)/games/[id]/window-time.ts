/**
 * Pure helpers for the `datetime-local` <-> UTC-instant boundary (invariant 6).
 * No React, no I/O — data in, data out, so these are unit-testable without fixtures.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Render a `Date` as a `datetime-local` input value, in the browser's local zone. */
export function toLocalInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Convert a `datetime-local` value (local wall-clock time, no offset) to a UTC ISO
 * instant string. `new Date(s)` on a `YYYY-MM-DDTHH:mm` string is interpreted as local
 * time by the spec, which is exactly what we want here.
 */
export function fromLocalInputValue(s: string): string {
  return new Date(s).toISOString();
}
