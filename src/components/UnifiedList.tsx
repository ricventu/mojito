"use client";
import { useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { dismissSession } from "@/lib/dismissSession";
import LaunchSheet from "./LaunchSheet";
import NewSessionSheet from "./NewSessionSheet";
import FilterBar from "./FilterBar";
import ActiveFilters from "./ActiveFilters";
import { activeFilters, removeFilter, type ActiveFilter } from "@/lib/activeFilters";
import { NO_FILTERS, type ListFilters } from "@/lib/appLocation";
import TicketCard from "./TicketCard";
import SessionCard from "./SessionCard";
import StatusBadge from "./StatusBadge";
import ProjectToolbar from "./ProjectToolbar";
import { mineOnly, liveStatuses } from "@/lib/ticketFilter";
import { ticketUrls } from "@/lib/ticketLink";
import { useProjects } from "@/lib/useProjects";
import { useStacks } from "@/lib/useStacks";
import { stackFor } from "@/lib/projectToolbar";
import { soleProject } from "@/lib/sheetProject";
import { sessionStatus } from "@/lib/sessionFilter";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderSessions } from "@/lib/orderSessions";
import { isActiveSession } from "@/lib/activeSession";
import {
  buildUnifiedRows, groupByProject, mergedProjects, mergedStatuses, orderTicketRows,
  withManagedSections,
} from "@/lib/unifiedRows";
import type { SelfUpdate } from "@/lib/useSelfUpdate";
import type { SessionMeta, TicketSummary } from "@/server/types";

/** Divider label for the sessions that hang off no visible ticket. */
const NO_TICKET = "No ticket";

export default function UnifiedList(
  {
    token, tickets, sessions, filters, onFilters, selfUpdate,
    onLaunched, onChanged, onNewTicket, onSettings, onOpen, onOpenTicketDocs, onOpenSessionDocs,
  }: {
    token: string;
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    filters: ListFilters;
    onFilters: (f: ListFilters, mode: "push" | "replace") => void;
    // Owned by the page (one instance, shared with the Settings sheet) so the project
    // toolbar's "Pull & deploy" and that sheet's can never disagree about whether a
    // deploy is in flight — see useSelfUpdate.
    selfUpdate: SelfUpdate;
    onLaunched: () => void;
    onChanged: () => void;
    // Owned by the page, not here: the same sheet is reachable from the terminal
    // header, which this component is not on screen for (RIC-224).
    onNewTicket: () => void;
    // The board's toolbar is where Settings lives since the bottom nav was retired
    // (RIC-253); the sheet itself stays the page's, like the two above.
    onSettings: () => void;
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
  const setProject = (p: string[]) => setFilter("project", p);
  const setStatus = (s: string | null) => setFilter("status", s);
  const setMine = (v: boolean) => setFilter("mine", v);
  const setSessionsOnly = (v: boolean) => setFilter("sessionsOnly", v);

  // Mine is a scope, applied before everything else so the chips below describe only
  // the tickets that can actually appear.
  const scoped = useMemo(() => mineOnly(tickets, mine), [tickets, mine]);
  // Built from the unscoped list on purpose (see liveStatuses): a session's own
  // launchStatus is frozen at launch, and Mine must not decide which status it reports.
  const live = useMemo(() => liveStatuses(tickets), [tickets]);
  // The filter offers every configured project, not just the ones the board happens to
  // name (RIC-225) — see mergedProjects.
  const configured = useProjects(token);
  const projects = useMemo(
    () => mergedProjects(scoped, sessions, configured),
    [scoped, sessions, configured],
  );
  const statuses = useMemo(() => mergedStatuses(scoped, sessions, live), [scoped, sessions, live]);
  // Unscoped like `live`, and for the same reason: the loose cards below show a ticket
  // id without holding the ticket, and Mine must not decide whether that id can link
  // to its issue on Linear.
  const urls = useMemo(() => ticketUrls(tickets), [tickets]);

  const { ticketRows, looseSessions } = useMemo(
    () => buildUnifiedRows({
      tickets: scoped, sessions, filter: { query, project, status }, sessionsOnly, live,
    }),
    [scoped, sessions, query, project, status, sessionsOnly, live],
  );

  // Every mapped project's stack state, for the toolbars on the project dividers
  // (RIC-253). A project with no row here — NO_PROJECT, or one projects.json has
  // dropped since a session named it — simply gets the plain divider it always had.
  const { stacks, refresh: refreshStacks } = useStacks(token);

  // Bucket both kinds by project — see groupByProject for the encounter-order and
  // never-lost-a-section rules — then pad the selected projects the board has no rows
  // for, which is what keeps a quiet project's toolbar reachable (withManagedSections).
  const projectSections = useMemo(
    () => withManagedSections(
      groupByProject(ticketRows, looseSessions),
      project,
      stacks.map((s) => s.project),
    ),
    [ticketRows, looseSessions, project, stacks],
  );

  const chips = useMemo(
    () => activeFilters({ query, project, status, mine, sessionsOnly }),
    [query, project, status, mine, sessionsOnly],
  );

  // One entry, not one setter per key: which values a chip drops is removeFilter's,
  // and a project chip drops only its own project (RIC-252) rather than the selection.
  const clearFilter = (chip: ActiveFilter) => onFilters(removeFilter(filters, chip), "push");

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

  // The badge on the toolbar's gear row, counted here now that the nav it used to ride
  // on is gone. Sessions are not scoped by any filter for this: it answers "is anything
  // waiting for me", which a narrowed board must not be able to understate.
  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  const empty = tickets.length === 0 && sessions.length === 0;
  const noMatches = !empty && ticketRows.length === 0 && looseSessions.length === 0;

  return (
    <div className="pad">
      {empty && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">Nothing here yet.</p>
          <button className="btn primary block" onClick={onNewTicket}>+ New ticket</button>
          <button className="btn ghost block" onClick={() => setNewSession(true)}>New session</button>
          {/* Spelled out rather than a gear: the toolbar that carries the icon is not
              rendered on an empty board, and Settings has to stay reachable — it is
              where "Pull & deploy" lives, which is exactly what an empty board (a
              Linear outage, a bad deploy) can call for. */}
          <button className="btn ghost block" onClick={onSettings}>Settings</button>
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
              {needsInput > 0 && (
                <span className="count" title={`${needsInput} session${needsInput === 1 ? "" : "s"} waiting for input`}>
                  {needsInput}
                </span>
              )}
              <button className="btn ghost sm icon settings" aria-label="Settings" title="Settings" onClick={onSettings}>
                <Settings size={15} aria-hidden="true" />
              </button>
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
          <ProjectToolbar
            project={sec.project}
            stack={stackFor(stacks, sec.project)}
            token={token}
            refresh={refreshStacks}
            onOpenSession={onOpen}
            selfUpdate={selfUpdate}
          />
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
                      ticketUrl={s.ticket ? urls.get(s.ticket) : undefined}
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
        <NewSessionSheet token={token} defaultProject={soleProject(project)}
          onClose={() => setNewSession(false)} onLaunched={onChanged}
          onOpen={(s) => { setNewSession(false); onOpen(s); }} />
      )}
    </div>
  );
}
