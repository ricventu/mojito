import type { SessionState } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LOOK: Record<SessionState, { label: string; className: string }> = {
  starting: { label: "Starting", className: "text-sky-600 dark:text-sky-400" },
  running: { label: "Running", className: "text-emerald-600 dark:text-emerald-400" },
  "needs-input": {
    label: "Needs you",
    className: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  idle: { label: "Idle", className: "text-muted-foreground" },
  ended: { label: "Ended", className: "text-muted-foreground line-through" },
};

/** A session's live state as a small coloured pill. */
export function StateBadge({ state, className }: { state: SessionState; className?: string }) {
  const look = LOOK[state];
  return (
    <Badge variant="outline" className={cn(look.className, className)}>
      {look.label}
    </Badge>
  );
}
