import type { EndReason, SessionState } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { endLook } from "@/lib/endReason";
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

/**
 * A session's live state as a small coloured pill. An ended one says how it ended when that was
 * not the human's doing (out of memory, lost), in red; the full reason is its tooltip.
 */
export function StateBadge({
  state,
  endReason,
  className,
}: {
  state: SessionState;
  endReason?: EndReason | null;
  className?: string;
}) {
  if (state === "ended") {
    const end = endLook(endReason);
    return (
      <Badge
        variant="outline"
        title={end.description}
        className={cn(end.abnormal ? "border-red-500/50 text-red-600 dark:text-red-400" : LOOK.ended.className, className)}
      >
        {end.label}
      </Badge>
    );
  }
  const look = LOOK[state];
  return (
    <Badge variant="outline" className={cn(look.className, className)}>
      {look.label}
    </Badge>
  );
}
