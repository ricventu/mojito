"use client";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import LaunchSheet from "./LaunchSheet";
import NewTicketSheet from "./NewTicketSheet";
import NewSessionSheet from "./NewSessionSheet";
import FilterBar from "./FilterBar";
import ActiveFilters from "./ActiveFilters";
import { activeFilters, type FilterKey } from "@/lib/activeFilters";
import TicketCard from "./TicketCard";
import SessionCard from "./SessionCard";
import StatusBadge from "./StatusBadge";
import { mineOnly } from "@/lib/ticketFilter";
import { sessionStatus } from "@/lib/sessionFilter";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderSessions } from "@/lib/orderSessions";
import { isActiveSession } from "@/lib/activeSession";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  buildUnifiedRows, groupByProject, mergedProjects, mergedStatuses, orderTicketRows,
} from "@/lib/unifiedRows";
import type { SessionMeta, TicketSummary } from "@/server/types";

/** Divider label for the sessions that hang off no visible ticket. */
const NO_TICKET = "No ticket";

export default function UnifiedList(
  { token, tickets, sessions, onLaunched, onChanged, onOpen, onOpenTicketDocs, onOpenSessionDocs }: {
    token: string;
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    onLaunched: () => void;
    onChanged: () => void;
    onOpen: (s: SessionMeta) => void;
    onOpenTicketDocs: (t: TicketSummary) => void;
    onOpenSessionDocs: (s: SessionMeta) => void;
  },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const [newTicket, setNewTicket] = useState(false);
  const [newSession, setNewSession] = useState(false);

  // One set of filter keys for the merged list. The old mojito-tickets-* and
  // mojito-sessions-* keys are abandoned, so filters reset once after the update.
  const [query, setQuery] = usePersistedState("mojito-list-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-list-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
  const [statusRaw, setStatusRaw] = usePersistedState("mojito-list-status", "");
  const status = statusRaw === "" ? null : statusRaw;
  const setStatus = (s: string | null) => setStatusRaw(s ?? "");
  // Default on, as it was on the ticket list before the merge.
  const [mineRaw, setMineRaw] = usePersistedState("mojito-list-mine", "1");
  const mine = mineRaw !== "0";
  const setMine = (v: boolean) => setMineRaw(v ? "1" : "0");
  // Default off: the full board is the landing view.
  const [sessionsRaw, setSessionsRaw] = usePersistedState("mojito-list-sessions", "0");
  const sessionsOnly = sessionsRaw === "1";
  const setSessionsOnly = (v: boolean) => setSessionsRaw(v ? "1" : "0");

  // Mine is a scope, applied before everything else so the chips below describe only
  // the tickets that can actually appear.
  const scoped = useMemo(() => mineOnly(tickets, mine), [tickets, mine]);
  const projects = useMemo(() => mergedProjects(scoped, sessions), [scoped, sessions]);
  const statuses = useMemo(() => mergedStatuses(scoped, sessions), [scoped, sessions]);

  const { ticketRows, looseSessions } = useMemo(
    () => buildUnifiedRows({
      tickets: scoped, sessions, filter: { query, project, status }, sessionsOnly,
    }),
    [scoped, sessions, query, project, status, sessionsOnly],
  );

  // Bucket both kinds by project — see groupByProject for the encounter-order and
  // never-lost-a-section rules.
  const projectSections = useMemo(
    () => groupByProject(ticketRows, looseSessions),
    [ticketRows, looseSessions],
  );

  const filters = useMemo(
    () => activeFilters({ query, project, status, mine, sessionsOnly }),
    [query, project, status, mine, sessionsOnly],
  );

  const clearFilter = (key: FilterKey) => {
    // A Record rather than a switch: TypeScript requires every FilterKey to have an
    // entry, so a new filter fails to compile here instead of silently no-op'ing when
    // its chip is tapped.
    const clear: Record<FilterKey, () => void> = {
      query: () => setQuery(""),
      project: () => setProject(null),
      status: () => setStatus(null),
      mine: () => setMine(false),
      sessions: () => setSessionsOnly(false),
    };
    clear[key]();
  };

  const clearAllFilters = () => {
    setQuery("");
    setProject(null);
    setStatus(null);
    setMine(false);
    setSessionsOnly(false);
  };

  const dismiss = async (s: SessionMeta) => {
    const label = s.ticket || s.title;
    const prompt = isActiveSession(s)
      ? `Kill the running session for ${label}?`
      : `Dismiss the session for ${label}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  const cleanup = async () => {
    if (!confirm("Remove all orphaned sessions (their tmux is gone)?")) return;
    await apiFetch(token, "/api/sessions/sweep", { method: "POST" });
    onChanged();
  };

  const empty = tickets.length === 0 && sessions.length === 0;
  const noMatches = !empty && ticketRows.length === 0 && looseSessions.length === 0;

  return (
    <div className="pad">
      {empty && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">Nothing here yet.</p>
          <button className="btn primary block" onClick={() => setNewTicket(true)}>+ New ticket</button>
          <button className="btn ghost block" onClick={() => setNewSession(true)}>New session</button>
        </div>
      )}
      {!empty && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          statuses={statuses} activeStatus={status} onStatus={setStatus}
          mine={mine} onMine={setMine}
          sessionsOnly={sessionsOnly} onSessionsOnly={setSessionsOnly}
          placeholder="Filter tickets and sessions…"
          action={
            <>
              <button className="btn primary sm" onClick={() => setNewTicket(true)}>+ Ticket</button>
              <button className="btn ghost sm" onClick={() => setNewSession(true)}>+ Session</button>
              <button className="btn ghost sm" onClick={cleanup}>Clean up</button>
            </>
          }
        />
      )}
      {/* Guarded by !empty for the same reason FilterBar is: with no tickets and no
          sessions at all there is nothing for a filter to be hiding. */}
      {!empty && (
        <ActiveFilters filters={filters} onClear={clearFilter} onClearAll={clearAllFilters} />
      )}
      {noMatches && (
        <p className="empty">
          {sessionsOnly ? "No active sessions." : "No matching tickets or sessions."}
        </p>
      )}
      {projectSections.map((sec) => (
        <section key={sec.project}>
          <h4 className="sect">{sec.project}</h4>
          {groupByStatus(sec.ticketRows, (r) => r.ticket.statusName).map((group) => (
            <div key={group.status}>
              <div className="substatus"><StatusBadge status={group.status} /></div>
              {orderTicketRows(group.items).map((row) => (
                <TicketCard
                  key={row.ticket.identifier}
                  row={row}
                  mine={mine}
                  onPick={() => setPicked(row.ticket)}
                  onOpenSession={onOpen}
                  onDismissSession={dismiss}
                />
              ))}
            </div>
          ))}
          {sec.sessions.length > 0 && (
            <>
              <div className="substatus"><span className="sub-label">{NO_TICKET}</span></div>
              {groupByStatus(sec.sessions, sessionStatus).map((group) => (
                <div key={group.status}>
                  {group.status && <div className="substatus"><StatusBadge status={group.status} /></div>}
                  {orderSessions(group.items).map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      onOpen={() => onOpen(s)}
                      onOpenDocs={() => onOpenSessionDocs(s)}
                      onDismiss={() => dismiss(s)}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      ))}
      {picked && (
        <LaunchSheet token={token} ticket={picked} sessions={sessions}
          onClose={() => setPicked(null)} onLaunched={onLaunched}
          onOpen={(s) => { setPicked(null); onOpen(s); }}
          onOpenDocs={() => { setPicked(null); onOpenTicketDocs(picked); }} />
      )}
      {newTicket && (
        <NewTicketSheet token={token} onClose={() => setNewTicket(false)} onCreated={onLaunched} />
      )}
      {newSession && (
        <NewSessionSheet token={token} onClose={() => setNewSession(false)} onLaunched={onChanged} />
      )}
    </div>
  );
}
