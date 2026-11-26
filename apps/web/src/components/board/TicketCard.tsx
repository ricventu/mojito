import type { CSSProperties, KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { SessionMeta, TicketSummary } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { PriorityIcon } from "@/components/PriorityIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canMarkDone } from "@/lib/board";
import { labelColor } from "@/lib/labels";
import { priorityInfo, ticketPriority } from "@/lib/priority";
import { safeHref } from "@/lib/url";
import { cn } from "@/lib/utils";

interface Props {
  ticket: TicketSummary;
  session: SessionMeta | null;
  /** Where `session` runs, named once there are peers (`cardSession`); null names nothing. */
  host?: string | null;
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
export function TicketCard({ ticket, session, host = null, selected, showStatus = true, onOpen, onDone }: Props) {
  const open = () => onOpen(ticket);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  const waiting = session?.state === "needs-input";
  const priority = ticketPriority(ticket);

  return (
    <li
      className={cn(
        "flex flex-col rounded-lg border bg-card text-card-foreground",
        waiting && "border-attention/60",
        selected && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* No mark for No priority: a card says only what was decided. */}
          {priority !== 0 && (
            <span role="img" aria-label={`Priority: ${priorityInfo(priority).name}`} title={priorityInfo(priority).name} className="flex">
              <PriorityIcon priority={priority} />
            </span>
          )}
          <a
            href={safeHref(ticket.url)}
            target="_blank"
            rel="noreferrer"
            // 24px tall for a finger (WCAG 2.5.8) without growing the row: the card's own tap
            // region starts just below, and a 16px link let a tap on the card's edge open Linear.
            className="-my-1 py-1 font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {ticket.identifier}
          </a>
        </span>
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
            {ticket.labels.map((label) => {
              const color = labelColor(ticket, label);
              return (
                <Badge key={label} variant="outline" className="max-w-full">
                  {/* Linear's own dot: a filled pill would read as a status or a session state. */}
                  {color && (
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full bg-(--label-color)"
                      style={{ "--label-color": color } as CSSProperties}
                    />
                  )}
                  <span className="truncate">{label}</span>
                </Badge>
              );
            })}
            {session && <StateBadge state={session.state} endReason={session.endReason} host={host} />}
          </div>
        )}
        {waiting && session.alert && (
          <p className="text-xs text-warning">{session.alert}</p>
        )}
      </div>
    </li>
  );
}
