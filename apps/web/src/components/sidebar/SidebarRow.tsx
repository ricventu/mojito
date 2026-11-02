import { Link } from "react-router";
import type { SessionMeta, SessionState } from "@mojito/shared";
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
  /** Where the row goes: this app's terminal for the session, on this instance or through a peer's relay. */
  to: string;
  label: { primary: string; secondary: string };
  current: boolean;
  /** Replace the history entry instead of pushing one (picking from a terminal). */
  replace: boolean;
  /** A plain click on the row; a modified click opens a new tab and leaves the page alone. */
  onPick(): void;
}

const ROW_LINK =
  "flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * One live session: its state dot and label are a link to its terminal (so Cmd/middle-click
 * and a long-press work as on any link). A peer's session is the same row: its terminal opens
 * in this client, through the relay.
 */
export function SidebarRow({ session, to, label, current, replace, onPick }: Props) {
  const dot = DOT[session.state];
  const { primary, secondary } = label;
  const body = (
    <>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot.className)} />
      <span className="sr-only">{dot.label}:</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm font-medium", session.kind === "ticket" && session.ticket && "font-mono")}>
          {primary}
        </span>
        {secondary && <span className="truncate text-xs text-muted-foreground">{secondary}</span>}
      </span>
    </>
  );

  return (
    <li className={cn("flex flex-col rounded-md", current && "bg-accent text-accent-foreground")}>
      <Link
        to={to}
        replace={replace}
        onClick={(e) => {
          if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onPick();
        }}
        aria-current={current ? "page" : undefined}
        className={ROW_LINK}
      >
        {body}
      </Link>
    </li>
  );
}
