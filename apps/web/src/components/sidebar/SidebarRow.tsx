import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router";
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
  /** Replace the history entry instead of pushing one (picking from a terminal). */
  replace: boolean;
  /** A plain click on the row; a modified click opens a new tab and leaves the page alone. */
  onPick(): void;
  onHide(hidden: boolean): void;
}

/**
 * One live session: its state dot and label are a link to its terminal (so Cmd/middle-click
 * and a long-press work as on any link); the eye beside it hides or shows it — with a mouse,
 * only on hover or focus, so a column of eyes does not out-shout the labels.
 */
export function SidebarRow({ session, label, current, replace, onPick, onHide }: Props) {
  const dot = DOT[session.state];
  const { primary, secondary } = label;

  return (
    <li className={cn("group/row flex items-center gap-1 rounded-md pr-1", current && "bg-accent text-accent-foreground")}>
      <Link
        to={`/session/${encodeURIComponent(session.id)}`}
        replace={replace}
        onClick={(e) => {
          if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onPick();
        }}
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
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100"
        aria-label={session.hidden ? `Show ${primary}` : `Hide ${primary}`}
        onClick={() => onHide(!session.hidden)}
      >
        {session.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
      </Button>
    </li>
  );
}
