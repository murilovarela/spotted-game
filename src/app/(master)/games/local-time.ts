/**
 * Display-boundary formatting for a game window (invariant 6: UTC everywhere, converted
 * only here). Pure: locale and zone are parameters so tests are deterministic.
 */
export function formatLocalRange(startsAt: string | null, endsAt: string | null, locale: string, timeZone: string): string {
  if (startsAt === null || endsAt === null) return "No window yet";
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone });
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone });
  const sameDay = day.format(start) === day.format(end);
  const endText = sameDay ? time.format(end) : `${day.format(end)}, ${time.format(end)}`;
  return `${day.format(start)}, ${time.format(start)} – ${endText}`;
}
