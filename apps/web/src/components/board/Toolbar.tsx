import { Plus, Settings, SquareTerminal } from "lucide-react";
import { Link } from "react-router";
import type { SessionMeta } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { needsInput } from "@/lib/board";

interface Props {
  sessions: SessionMeta[];
  onNewTicket: () => void;
  onNewSession: () => void;
  /** Extra rows kept inside the sticky bar, under the title row. */
  children?: React.ReactNode;
}

/** Sticky top bar. It pays the top safe-area inset itself: the board is full-bleed. */
export function Toolbar({ sessions, onNewTicket, onNewSession, children }: Props) {
  const waiting = needsInput(sessions);

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 pt-[var(--sat)] pr-[var(--sar)] pl-[var(--sal)] backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">Mojito</h1>
        {waiting.length > 0 && (
          <Button
            asChild
            size="sm"
            className="bg-amber-500 text-amber-950 hover:bg-amber-500/90"
          >
            <Link to={`/session/${encodeURIComponent(waiting[0].id)}`} aria-label={`${waiting.length} sessions waiting for a reply`}>
              {waiting.length}
              <span className="max-[420px]:sr-only">waiting</span>
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onNewTicket}>
          <Plus size={14} /> Ticket
        </Button>
        <Button variant="outline" size="sm" onClick={onNewSession}>
          <SquareTerminal size={14} /> Session
        </Button>
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/settings" aria-label="Settings">
            <Settings size={16} />
          </Link>
        </Button>
      </div>
      {children && <div className="mx-auto max-w-3xl px-4 pb-2">{children}</div>}
    </div>
  );
}
