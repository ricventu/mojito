import { Eye, EyeOff } from "lucide-react";
import type { SessionMeta, SessionState } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DOT: Record<SessionState, { label: string; className: string }> = {
  starting: { label: "Starting", className: "bg-sky-500" },
  running: { label: "Running", className: "bg-emerald-500" },
  "needs-input": { label: "Needs you", className: "bg-amber-500" },
  idle: { label: "Idle", className: "bg-muted-foreground/40" },
  ended: { label: "Ended", className: "bg-muted-foreground/40" },
};

interface Props {
  session: SessionMeta;
  label: { primary: string; secondary: string };
  current: boolean;
  onPick(): void;
  onHide(hidden: boolean): void;
}

/** One live session: its state dot and label open its terminal; the eye beside it hides or shows it. */
export function SidebarRow({ session, label, current, onPick, onHide }: Props) {
  const dot = DOT[session.state];
  const { primary, secondary } = label;

  return (
    <li className={cn("flex items-center gap-1 rounded-md pr-1", current && "bg-accent text-accent-foreground")}>
      <button
        type="button"
        onClick={onPick}
        aria-current={current ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot.className)} />
        <span className="sr-only">{dot.label}:</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm font-medium", session.kind === "ticket" && session.ticket && "font-mono")}>
            {primary}
          </span>
          {secondary && <span className="truncate text-xs text-muted-foreground">{secondary}</span>}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label={session.hidden ? `Show ${primary}` : `Hide ${primary}`}
        onClick={() => onHide(!session.hidden)}
      >
        {session.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
      </Button>
    </li>
  );
}
