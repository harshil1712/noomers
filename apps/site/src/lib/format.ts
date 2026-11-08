// Content dates are calendar days (YYYY-MM-DD → UTC midnight), so format in UTC
// to stop the day shifting with the build machine's timezone.
const DATE = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Oct 30, 2026". The one date format used across the site. */
export function formatDate(d: Date): string {
  return DATE.format(d);
}

/** "2026-10-30", for `<time datetime>`. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when two dates fall on the same calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return isoDate(a) === isoDate(b);
}
