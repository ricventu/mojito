import type { KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { SessionMeta, TicketSummary } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canMarkDone } from "@/lib/board";
import { safeHref } from "@/lib/url";
import { cn } from "@/lib/utils";

interface Props {
  ticket: TicketSummary;
  session: SessionMeta | null;
  selected?: boolean;
  /** Off in a kanban column, whose heading already says it. */
  showStatus?: boolean;
  onOpen: (ticket: TicketSummary) => void;
  /** The quick Done, offered on an In Review card. */
  onDone?: (ticket: TicketSummary) => void;
}

/**
 * The id is a link to Linear and sits outside the tappable region: a `role="button"`
 * element's children are presentational to assistive tech, so a link inside it could not
 * be reached on its own. Done sits beside it for the same reason.
 */
export function TicketCard({ ticket, session, selected, showStatus = true, onOpen, onDone }: Props) {
  const open = () => onOpen(ticket);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  const waiting = session?.state === "needs-input";

  return (
    <li
      className={cn(
        "flex flex-col rounded-lg border bg-card text-card-foreground",
        waiting && "border-amber-500/60",
        selected && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <a
          href={safeHref(ticket.url)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {ticket.identifier}
        </a>
        {onDone && canMarkDone(ticket.statusName) && (
          <Button
            variant="outline"
            size="xs"
            className="-my-1"
            aria-label={`Mark ${ticket.identifier} Done`}
            onClick={() => onDone(ticket)}
          >
            <Check size={12} /> Done
          </Button>
        )}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKeyDown}
        className="flex flex-1 cursor-pointer flex-col gap-1.5 rounded-b-lg px-3 pt-1 pb-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <p className="min-w-0 text-sm leading-snug font-medium break-words">{ticket.title}</p>
        {(showStatus || ticket.labels.length > 0 || session) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {showStatus && <StatusBadge status={ticket.statusName} />}
            {ticket.labels.map((label) => (
              <Badge key={label} variant="outline" className="max-w-full truncate">
                {label}
              </Badge>
            ))}
            {session && <StateBadge state={session.state} endReason={session.endReason} />}
          </div>
        )}
        {waiting && session.alert && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{session.alert}</p>
        )}
      </div>
    </li>
  );
}
