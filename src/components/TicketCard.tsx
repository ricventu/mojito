"use client";
import SessionRow from "./SessionRow";
import TicketLink from "./TicketLink";
import { showsMineMarker } from "@/lib/ticketFilter";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
import { tapProps } from "@/lib/tapProps";
import type { SessionMeta } from "@/server/types";
import type { TicketRow } from "@/lib/unifiedRows";

/**
 * A ticket card with all of its sessions listed inside it — finished ones included.
 * Filtering to only the live ones would push a done or failed session out to the
 * "No ticket" group, which is worse: it would look orphaned instead of resolved.
 *
 * The card is a div, not a button as the old ticket list had it: nesting the session
 * rows' own controls inside a button is invalid HTML. The header keeps the whole-area
 * tap that opens LaunchSheet, the same way the session cards have always done it.
 *
 * There is no s-dot here. With the sessions listed inline it would state the same fact
 * twice; instead a session waiting on input colours the whole card via .card.attn.
 *
 * The id row sits outside the tap region, unlike everything else in the header: the id
 * links to the issue on Linear (RIC-242), and a link nested in a `role="button"` is
 * announced as part of the button rather than as a link of its own — see TicketLink.
 * The cost is a strip of card beside the id that opens nothing; the title and labels
 * below it, which is most of the card, still open the sheet.
 */
export default function TicketCard(
  { row, mine, onPick, onOpenSession, onDismissSession }: {
    row: TicketRow;
    mine: boolean;
    onPick: () => void;
    onOpenSession: (s: SessionMeta) => void;
    onDismissSession: (s: SessionMeta) => void;
  },
) {
  const { ticket, sessions } = row;
  const attn = activeSessionLevel(ticket.identifier, sessions) === "attn";
  return (
    <div className={`card${attn ? " attn" : ""}`}>
      <div className="card-head">
        <TicketLink id={ticket.identifier} url={ticket.url} />
        {showsMineMarker(ticket, mine) && <span className="chip mine">Mine</span>}
      </div>
      <div className="tap" {...tapProps(onPick)}>
        <div className="title">{ticket.title}</div>
        {ticket.labels.length > 0 && (
          <div className="meta">{ticket.labels.map((l) => <span key={l} className="chip">{l}</span>)}</div>
        )}
      </div>
      {sessions.length > 0 && (
        <div className="srows">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onOpen={() => onOpenSession(s)}
              onDismiss={() => onDismissSession(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
