import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { TicketSummary } from "@mojito/shared";
import { useBoardFilters } from "@/hooks/useBoardFilters";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useSidebar } from "@/hooks/useSidebar";
import { useTasks } from "@/hooks/useTasks";
import { useTickets } from "@/hooks/useTickets";
import { filterBoard, groupBoard, linearBanner } from "@/lib/board";
import { isFiltered, NO_FILTERS } from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { SessionSidebar } from "@/components/sidebar/SessionSidebar";
import { cn } from "@/lib/utils";
import { FilterBar } from "./FilterBar";
import { ProjectSection } from "./ProjectSection";
import { TaskStrip } from "./TaskStrip";
import { Toolbar } from "./Toolbar";
import { NewSessionSheet } from "@/components/sheets/NewSessionSheet";
import { NewTicketSheet } from "@/components/sheets/NewTicketSheet";
import { TicketSheet } from "@/components/sheets/TicketSheet";

function Banner({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
    >
      <TriangleAlert size={16} className="shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

/** The home page: toolbar, background tasks, then every project's tickets and loose sessions. */
export function Board() {
  const tickets = useTickets();
  const sessions = useSessions();
  const tasks = useTasks();
  const projects = useProjects();
  const sidebar = useSidebar();
  // The ticket whose sheet is open; the sheet is mounted from here once it exists.
  const [selectedTicket, setSelectedTicket] = useState<TicketSummary | null>(null);

  const sessionList = useMemo(() => sessions.data ?? [], [sessions.data]);
  const [filters, setFilters] = useBoardFilters();
  const sections = useMemo(
    () => filterBoard(groupBoard(projects.data ?? [], tickets.data?.tickets ?? [], sessionList), filters),
    [projects.data, tickets.data, sessionList, filters],
  );
  const banner = tickets.data ? linearBanner(tickets.data) : null;
  const loading = tickets.isPending || sessions.isPending || projects.isPending;
  // A failed refetch keeps the last data on screen; only a query that never had any is fatal.
  const queries = [tickets, sessions, projects];
  const failure = queries.find((q) => q.data === undefined && q.error)?.error;
  const refreshError = [...queries, tasks].find((q) => q.data !== undefined && q.error)?.error;
  // Tasks are not the board: a list that never loaded is a banner, not a failed page.
  const tasksError = tasks.data === undefined ? tasks.error : null;
  // The sheet follows the ticket as refetches change it (its status, after a move made there).
  const openTicket = selectedTicket
    ? (tickets.data?.tickets.find((t) => t.identifier === selectedTicket.identifier) ?? selectedTicket)
    : null;

  // `{ project }` is the section the sheet was opened from; `{}` is the toolbar's, with none preselected.
  const [newTicket, setNewTicket] = useState<{ project?: string } | null>(null);
  const [newSession, setNewSession] = useState<{ project?: string } | null>(null);
  const onNewTicket = (project?: string) => setNewTicket({ project });
  const onNewSession = (project?: string) => setNewSession({ project });

  return (
    // A docked sidebar is fixed on the left and pays its own insets; the page makes room for it.
    <div className={cn("min-h-dvh overflow-x-clip pb-[var(--sab)]", sidebar.docked && "pl-72")}>
      <SessionSidebar
        sidebar={sidebar}
        dockedClassName="fixed inset-y-0 left-0 z-20 pt-[var(--sat)] pb-[var(--sab)] pl-[var(--sal)]"
      />
      <Toolbar
        sessions={sessionList}
        onNewTicket={() => onNewTicket()}
        onNewSession={() => onNewSession()}
        sidebarOpen={sidebar.open}
        onToggleSidebar={sidebar.toggle}
      >
        <FilterBar filters={filters} setFilters={setFilters} />
      </Toolbar>
      <main className="@container mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-3 pr-[max(1rem,var(--sar))] pb-6 pl-[max(1rem,var(--sal))]">
        {banner && <Banner text={banner} />}
        {refreshError && (
          <Banner text={`Refresh failed: ${refreshError instanceof Error ? refreshError.message : "error"}`} />
        )}
        {tasksError && (
          <Banner text={`Background tasks unavailable: ${tasksError instanceof Error ? tasksError.message : "error"}`} />
        )}
        <TaskStrip tasks={tasks.data ?? []} />
        {failure ? (
          <p className="text-sm text-destructive">{failure instanceof Error ? failure.message : "Loading failed"}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sections.length === 0 ? (
          isFiltered(filters) ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
              <Button variant="outline" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tickets and no sessions.</p>
          )
        ) : (
          sections.map((section) => (
            <ProjectSection
              key={section.project ?? "general"}
              section={section}
              sessions={sessionList}
              selectedTicket={selectedTicket?.identifier}
              onOpenTicket={setSelectedTicket}
              onNewTicket={onNewTicket}
              onNewSession={onNewSession}
            />
          ))
        )}
      </main>
      {openTicket && <TicketSheet ticket={openTicket} onClose={() => setSelectedTicket(null)} />}
      {newTicket && <NewTicketSheet project={newTicket.project} onClose={() => setNewTicket(null)} />}
      {newSession && <NewSessionSheet project={newSession.project} onClose={() => setNewSession(null)} />}
    </div>
  );
}
