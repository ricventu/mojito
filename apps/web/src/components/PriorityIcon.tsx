import { Ellipsis, OctagonAlert, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Linear's priority as a small mark: Urgent an alert (in the foreground colour), High/Medium/Low
 * signal bars, No priority a dashed ellipsis. Neutral on purpose — emerald, sky, amber and red mean
 * a session's state. Decorative: the caller names it.
 */
export function PriorityIcon({ priority, size = 12, className }: { priority: number; size?: number; className?: string }) {
  const Icon = priority === 1 ? OctagonAlert : priority === 2 ? SignalHigh : priority === 3 ? SignalMedium : priority === 4 ? SignalLow : Ellipsis;
  return (
    <Icon
      aria-hidden
      size={size}
      className={cn("shrink-0", priority === 1 ? "text-foreground" : "text-muted-foreground", className)}
    />
  );
}
