import { Badge } from "@/components/ui/badge";

const NEUTRAL = "bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-secondary dark:hover:bg-secondary/80";

/**
 * Filled tints, so a status never reads as a label (outline) or as a session state (outline, or
 * amber/red when it calls for attention). Violet and blue because emerald, sky, amber and red mean
 * a session's state. Literal class names: Tailwind only generates what it finds in the source.
 */
const LOOK: Record<string, string> = {
  "In Review":
    "bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:bg-violet-500/25 dark:text-violet-300 dark:hover:bg-violet-500/35",
  "In Progress":
    "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:bg-blue-500/25 dark:text-blue-300 dark:hover:bg-blue-500/35",
};

/** The colour of a Linear status; Todo, Backlog and any custom status stay neutral. */
export const statusClass = (status: string): string => LOOK[status] ?? NEUTRAL;

/** A ticket's Linear status as a coloured pill. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge className={statusClass(status)}>{status}</Badge>;
}
