const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Compact mtime for a document row: "14:21" today, "yesterday", "3 days",
// "12 Jul" beyond a week. Day counts are calendar days, not 24-hour spans, so a
// file written at 23:00 reads as "yesterday" the next morning.
export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
