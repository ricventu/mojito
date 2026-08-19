"use client";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import { dismissSession } from "@/lib/dismissSession";
import LaunchSheet from "./LaunchSheet";
import NewSessionSheet from "./NewSessionSheet";
import FilterBar from "./FilterBar";
import ActiveFilters from "./ActiveFilters";
import { activeFilters, type FilterKey } from "@/lib/activeFilters";
import { NO_FILTERS, type ListFilters } from "@/lib/appLocation";
import TicketCard from "./TicketCard";
import SessionCard from "./SessionCard";
import StatusBadge from "./StatusBadge";
import { mineOnly, liveStatuses } from "@/lib/ticketFilter";
import { sessionStatus } from "@/lib/sessionFilter";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderSessions } from "@/lib/orderSessions";
import { isActiveSession } from "@/lib/activeSession";
import {
  buildUnifiedRows, groupByProject, mergedProjects, mergedStatuses, orderTicketRows,
} from "@/lib/unifiedRows";
import type { SessionMeta, TicketSummary } from "@/server/types";

/** Divider label for the sessions that hang off no visible ticket. */
const NO_TICKET = "No ticket";

export default function UnifiedList(
  {
    token, tickets, sessions, filters, onFilters,
    onLaunched, onChanged, onNewTicket, onOpen, onOpenTicketDocs, onOpenSessionDocs,
  }: {
    token: string;
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    filters: ListFilters;
    onFilters: (f: ListFilters, mode: "push" | "replace") => void;
    onLaunched: () => void;
    onChanged: () => void;
    // Owned by the page, not here: the same sheet is reachable from the terminal
    // header, which this component is not on screen for (RIC-224).
    onNewTicket: () => void;
    onOpen: (s: SessionMeta) => void;
    onOpenTicketDocs: (t: TicketSummary) => void;
    onOpenSessionDocs: (s: SessionMeta) => void;
  },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const [newSession, setNewSession] = useState(false);

  // The filters live in the url (see appLocation), not in this component and not in
  // localStorage: that is what gives every browser tab its own set, keeps them across
  // a reload, and puts each change in the browser's history. Every default is off /
  // empty, so "narrows the list" and "deviates from the default" are the same thing —
  // which is what lets activeFilters treat Mine like every other filter instead of
  // special-casing the one that would otherwise put a chip in the sticky bar on every
  // single visit, and what keeps the unfiltered board a bare `/`.
  const { query, project, status, mine, sessionsOnly } = filters;
  const setFilter = <K extends keyof ListFilters>(key: K, value: ListFilters[K]) =>
    onFilters({ ...filters, [key]: value }, "push");
  // Replace, not push: a pushed entry per keystroke would leave Back retyping the
  // query one character at a time. The chips and toggles below are discrete choices,
  // so each of those is worth its own entry.
  const setQuery = (v: string) => onFilters({ ...filters, query: v }, "replace");
  const setProject = (p: string | null) => setFilter("project", p);
  const setStatus = (s: string | null) => setFilter("status", s);
  const setMine = (v: boolean) => setFilter("mine", v);
  const setSessionsOnly = (v: boolean) => setFilter("sessionsOnly", v);

  // Mine is a scope, applied before everything else so the chips below describe only
  // the tickets that can actually appear.
  const scoped = useMemo(() => mineOnly(tickets, mine), [tickets, mine]);
  // Built from the unscoped list on purpose (see liveStatuses): a session's own
  // launchStatus is frozen at launch, and Mine must not decide which status it reports.
  const live = useMemo(() => liveStatuses(tickets), [tickets]);
  const projects = useMemo(() => mergedProjects(scoped, sessions), [scoped, sessions]);
  const statuses = useMemo(() => mergedStatuses(scoped, sessions, live), [scoped, sessions, live]);

  const { ticketRows, looseSessions } = useMemo(
    () => buildUnifiedRows({
      tickets: scoped, sessions, filter: { query, project, status }, sessionsOnly, live,
    }),
    [scoped, sessions, query, project, status, sessionsOnly, live],
  );

  // Bucket both kinds by project — see groupByProject for the encounter-order and
  // never-lost-a-section rules.
  const projectSections = useMemo(
    () => groupByProject(ticketRows, looseSessions),
    [ticketRows, looseSessions],
  );

  const chips = useMemo(
    () => activeFilters({ query, project, status, mine, sessionsOnly }),
    [query, project, status, mine, sessionsOnly],
  );

  const clearFilter = (key: FilterKey) => {
    // A Record rather than a switch: TypeScript requires every FilterKey to have an
    // entry, so a new filter fails to compile here instead of silently no-op'ing when
    // its chip is tapped.
    const clear: Record<FilterKey, () => void> = {
      query: () => setFilter("query", ""),
      project: () => setProject(null),
      status: () => setStatus(null),
      mine: () => setMine(false),
      sessions: () => setSessionsOnly(false),
    };
    clear[key]();
  };

  // One call, not five setters: each would be its own history entry, leaving Back to
  // walk the filters on again one at a time.
  const clearAllFilters = () => onFilters(NO_FILTERS, "push");

  const dismiss = async (s: SessionMeta) => {
    const label = s.ticket || s.title;
    const prompt = isActiveSession(s)
      ? `Kill the running session for ${label}?`
      : `Dismiss the session for ${label}?`;
    if (!confirm(prompt)) return;
    // A refusal has to be said out loud: the server keeps a session whose claude is
    // still running, so an ignored status left the card sitting there with no reason
    // given — which reads as a dead button.
    const err = await dismissSession(token, s.id);
    if (err) alert(err);
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
          <button className="btn primary block" onClick={onNewTicket}>+ New ticket</button>
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
              <button className="btn primary sm" onClick={onNewTicket}>+ Ticket</button>
              <button className="btn ghost sm" onClick={() => setNewSession(true)}>+ Session</button>
              <button className="btn ghost sm" onClick={cleanup}>Clean up</button>
            </>
          }
        />
      )}
      {/* Guarded by !empty for the same reason FilterBar is: with no tickets and no
          sessions at all there is nothing for a filter to be hiding. */}
      {!empty && (
        <ActiveFilters filters={chips} onClear={clearFilter} onClearAll={clearAllFilters} />
      )}
      {noMatches && (
        <p className="empty">
          {sessionsOnly ? "No sessions." : "No matching tickets or sessions."}
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
              {groupByStatus(sec.sessions, (s) => sessionStatus(s, live)).map((group) => (
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
      {newSession && (
        <NewSessionSheet token={token} defaultProject={project}
          onClose={() => setNewSession(false)} onLaunched={onChanged}
          onOpen={(s) => { setNewSession(false); onOpen(s); }} />
      )}
    </div>
  );
}
