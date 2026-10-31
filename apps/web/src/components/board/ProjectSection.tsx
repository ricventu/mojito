import { ChevronRight, FileText, GitGraph, Plus, SquareTerminal } from "lucide-react";
import { Link } from "react-router";
import type { SessionMeta, TicketSummary } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { kanbanColumns, sessionForTicket, type BoardSection } from "@/lib/board";
import { docsHref } from "@/lib/docs/url";
import { gitHref } from "@/lib/git/url";
import { cn } from "@/lib/utils";
import { GitButtons } from "./GitButtons";
import { LooseSessionRow } from "./LooseSessionRow";
import { TicketCard } from "./TicketCard";

interface Props {
  section: BoardSection;
  sessions: SessionMeta[];
  selectedTicket?: string;
  onOpenTicket: (ticket: TicketSummary) => void;
  onNewTicket: (project?: string) => void;
  onNewSession: (project?: string) => void;
  /** The board's status filter: the kanban shows only the columns it selects. */
  statusFilter: readonly string[];
}

/**
 * Backlog cards and loose rows: one column on a phone, three from the width the kanban starts at,
 * level with its columns (a container query on the board's column, which a docked sidebar narrows).
 */
const LIST_CLASS = "grid grid-cols-1 gap-2 @2xl:grid-cols-3";

/**
 * One project: its active tickets — a list on a phone, kanban columns from `@2xl` — a closed
 * Backlog group, then its loose sessions.
 */
export function ProjectSection({ section, sessions, selectedTicket, onOpenTicket, onNewTicket, onNewSession, statusFilter }: Props) {
  const { project } = section;
  const name = project ?? "General";
  const card = (ticket: TicketSummary, showStatus = true) => (
    <TicketCard
      key={ticket.identifier}
      ticket={ticket}
      session={sessionForTicket(sessions, ticket.identifier)}
      selected={ticket.identifier === selectedTicket}
      showStatus={showStatus}
      onOpen={onOpenTicket}
    />
  );

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
        {project !== null && (
          <Button asChild variant="ghost" size="icon-sm">
            <Link to={gitHref(project)} aria-label={`Git graph of ${project}`} title="Git graph">
              <GitGraph size={16} />
            </Link>
          </Button>
        )}
        {project !== null && (
          <Button asChild variant="ghost" size="icon-sm">
            <Link to={docsHref(project)} aria-label={`Docs of ${project}`} title="Docs">
              <FileText size={16} />
            </Link>
          </Button>
        )}
        {project !== null && <GitButtons project={project} />}
        {project !== null && (
          <Button variant="ghost" size="icon-sm" aria-label={`New ticket in ${name}`} onClick={() => onNewTicket(project)}>
            <Plus size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`New session in ${name}`}
          onClick={() => onNewSession(project ?? undefined)}
        >
          <SquareTerminal size={16} />
        </Button>
      </header>

      {section.active.length > 0 && (
        <>
          <ul className="flex flex-col gap-2 @2xl:hidden">{section.active.map((t) => card(t))}</ul>
          {/* Both are rendered and CSS picks one: no width to measure, nothing jumps on the first paint. */}
          <div className="hidden gap-2 @2xl:grid @2xl:auto-cols-fr @2xl:grid-flow-col">
            {kanbanColumns(section.active, statusFilter).map((column) => (
              <section
                key={column.status}
                aria-label={`${column.status} in ${name}`}
                className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
              >
                <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                  {column.status}
                  <span className="tabular-nums">{column.tickets.length}</span>
                </h3>
                <ul className="flex flex-col gap-2">
                  {/* "Other" gathers several statuses: there the badge still says which. */}
                  {column.tickets.map((t) => card(t, column.status === "Other"))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {section.backlog.length > 0 && (
        <Collapsible key={String(section.backlogOpen)} defaultOpen={section.backlogOpen} className="group/backlog">
          <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRight size={14} className="transition-transform group-data-[state=open]/backlog:rotate-90" />
            Backlog ({section.backlog.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className={cn(LIST_CLASS, "pt-1")}>{section.backlog.map((t) => card(t))}</ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {section.loose.length > 0 && (
        <ul className={LIST_CLASS}>
          {section.loose.map((s) => (
            <LooseSessionRow key={s.id} session={s} />
          ))}
        </ul>
      )}
    </section>
  );
}
