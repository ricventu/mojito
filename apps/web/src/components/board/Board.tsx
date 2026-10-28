import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { TicketSummary } from "@mojito/shared";
import { useProjects } from "@/hooks/useProjects";
import { useSessions } from "@/hooks/useSessions";
import { useTasks } from "@/hooks/useTasks";
import { useTickets } from "@/hooks/useTickets";
import { groupBoard, linearBanner } from "@/lib/board";
import { ProjectSection } from "./ProjectSection";
import { TaskStrip } from "./TaskStrip";
import { Toolbar } from "./Toolbar";

/** The home page: toolbar, background tasks, then every project's tickets and free sessions. */
export function Board() {
  const tickets = useTickets();
  const sessions = useSessions();
  const tasks = useTasks();
  const projects = useProjects();
  // The ticket whose sheet is open; the sheet is mounted from here once it exists.
  const [selectedTicket, setSelectedTicket] = useState<TicketSummary | null>(null);

  const sessionList = useMemo(() => sessions.data ?? [], [sessions.data]);
  const sections = useMemo(
    () => groupBoard(projects.data ?? [], tickets.data?.tickets ?? [], sessionList),
    [projects.data, tickets.data, sessionList],
  );
  const banner = tickets.data ? linearBanner(tickets.data) : null;
  const loading = tickets.isPending || sessions.isPending || projects.isPending;
  const failure = tickets.error ?? sessions.error ?? projects.error;

  // Wired to the new-ticket and new-session sheets when those exist.
  const onNewTicket = (_project?: string) => {};
  const onNewSession = (_project?: string) => {};

  return (
    <div className="min-h-dvh overflow-x-hidden pb-[var(--sab)]">
      <Toolbar sessions={sessionList} onNewTicket={() => onNewTicket()} onNewSession={() => onNewSession()} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-3 pr-[max(1rem,var(--sar))] pb-6 pl-[max(1rem,var(--sal))]">
        {banner && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
          >
            <TriangleAlert size={16} className="shrink-0" />
            <span className="min-w-0 break-words">{banner}</span>
          </div>
        )}
        <TaskStrip tasks={tasks.data ?? []} />
        {failure ? (
          <p className="text-sm text-destructive">{failure instanceof Error ? failure.message : "Errore di caricamento"}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun ticket e nessuna sessione.</p>
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
    </div>
  );
}
