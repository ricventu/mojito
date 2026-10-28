import { ChevronRight, Plus, SquareTerminal } from "lucide-react";
import type { SessionMeta, TicketSummary } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { sessionForTicket, type BoardSection } from "@/lib/board";
import { LooseSessionRow } from "./LooseSessionRow";
import { TicketCard } from "./TicketCard";

interface Props {
  section: BoardSection;
  sessions: SessionMeta[];
  selectedTicket?: string;
  onOpenTicket: (ticket: TicketSummary) => void;
  onNewTicket: (project?: string) => void;
  onNewSession: (project?: string) => void;
}

/** One project: its active tickets, a closed Backlog group, then its loose sessions. */
export function ProjectSection({ section, sessions, selectedTicket, onOpenTicket, onNewTicket, onNewSession }: Props) {
  const { project } = section;
  const name = project ?? "General";
  const card = (ticket: TicketSummary) => (
    <TicketCard
      key={ticket.identifier}
      ticket={ticket}
      session={sessionForTicket(sessions, ticket.identifier)}
      selected={ticket.identifier === selectedTicket}
      onOpen={onOpenTicket}
    />
  );

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
        {project !== null && (
          <Button variant="ghost" size="icon-sm" aria-label={`Nuovo ticket in ${name}`} onClick={() => onNewTicket(project)}>
            <Plus size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Nuova sessione in ${name}`}
          onClick={() => onNewSession(project ?? undefined)}
        >
          <SquareTerminal size={16} />
        </Button>
      </header>

      {section.active.length > 0 && <ul className="flex flex-col gap-2">{section.active.map(card)}</ul>}

      {section.backlog.length > 0 && (
        <Collapsible className="group/backlog">
          <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRight size={14} className="transition-transform group-data-[state=open]/backlog:rotate-90" />
            Backlog ({section.backlog.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-2 pt-1">{section.backlog.map(card)}</ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {section.loose.length > 0 && (
        <ul className="flex flex-col gap-2">
          {section.loose.map((s) => (
            <LooseSessionRow key={s.id} session={s} />
          ))}
        </ul>
      )}
    </section>
  );
}
