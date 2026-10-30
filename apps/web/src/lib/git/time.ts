// "5 minutes ago", "yesterday", "3 months ago": the largest unit that fits, whole units.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  if (Number.isNaN(diff)) return "";
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.trunc(diff / ms), unit);
  }
  return format.format(0, "second");
}
