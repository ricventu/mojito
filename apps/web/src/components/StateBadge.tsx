import type { EndReason, SessionState } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { endLook } from "@/lib/endReason";
import { cn } from "@/lib/utils";

const LOOK: Record<SessionState, { label: string; className: string }> = {
  starting: { label: "Starting", className: "text-info" },
  running: { label: "Running", className: "text-success" },
  "needs-input": {
    label: "Needs you",
    className: "border-attention/50 bg-attention/15 text-warning",
  },
  idle: { label: "Idle", className: "text-muted-foreground" },
  // Struck on the label alone (`Label`), so a host after it stays readable.
  ended: { label: "Ended", className: "text-muted-foreground" },
};

/**
 * A session's live state as a small coloured pill. An ended one says how it ended when that was
 * not the human's doing (out of memory, lost), in red; the full reason is its tooltip. `host`, when
 * given, follows the state muted (`Running · mac`): where the session runs, once there are peers.
 */
export function StateBadge({
  state,
  endReason,
  host,
  className,
}: {
  state: SessionState;
  endReason?: EndReason | null;
  host?: string | null;
  className?: string;
}) {
  const hostPart = host ? <span className="truncate font-normal text-muted-foreground">· {host}</span> : null;
  if (state === "ended") {
    const end = endLook(endReason);
    return (
      <Badge
        variant="outline"
        title={end.description}
        className={cn("max-w-full", end.abnormal ? "border-danger/50 text-danger" : LOOK.ended.className, className)}
      >
        <span className={cn(!end.abnormal && "line-through")}>{end.label}</span>
        {hostPart}
      </Badge>
    );
  }
  const look = LOOK[state];
  return (
    <Badge variant="outline" className={cn("max-w-full", look.className, className)}>
      {look.label}
      {hostPart}
    </Badge>
  );
}
