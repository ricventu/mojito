"use client";
import { useMemo, useState } from "react";
import LaunchSheet from "./LaunchSheet";
import NewTicketSheet from "./NewTicketSheet";
import FilterBar, { NO_PROJECT } from "./FilterBar";
import { filterTickets, mineOnly, showsMineMarker, ticketStatuses } from "@/lib/ticketFilter";
import { usePersistedState } from "@/lib/usePersistedState";
import type { SessionMeta, TicketSummary } from "@/server/types";
import { activeSessionLevel, type ActiveLevel } from "@/lib/ticketSessionLevel";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderTickets } from "@/lib/orderTickets";
import StatusBadge from "./StatusBadge";

export default function TicketList(
  { token, tickets, sessions, onLaunched, onOpen, onOpenDocs }:
  { token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void;
    onOpen: (s: SessionMeta) => void; onOpenDocs: (t: TicketSummary) => void },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const [query, setQuery] = usePersistedState("mojito-tickets-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-tickets-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
  const [newOpen, setNewOpen] = useState(false);
  const [statusRaw, setStatusRaw] = usePersistedState("mojito-tickets-status", "");
  const status = statusRaw === "" ? null : statusRaw;
  const setStatus = (s: string | null) => setStatusRaw(s ?? "");
  // Default on: with no stored value the list looks the way it did before the toggle existed.
  const [mineRaw, setMineRaw] = usePersistedState("mojito-tickets-mine", "1");
  const mine = mineRaw !== "0";
  const setMine = (v: boolean) => setMineRaw(v ? "1" : "0");

  // The assignee scope comes first so the project and status chips below describe only
  // the tickets actually on screen.
  const scoped = useMemo(() => mineOnly(tickets, mine), [tickets, mine]);
  const projects = useMemo(
    () => Array.from(new Set(scoped.map((t) => t.project ?? NO_PROJECT))).sort(),
    [scoped],
  );
  const statuses = useMemo(() => ticketStatuses(scoped), [scoped]);

  const levels = useMemo(() => {
    const m = new Map<string, ActiveLevel>();
    for (const t of tickets) {
      const level = activeSessionLevel(t.identifier, sessions);
      if (level) m.set(t.identifier, level);
    }
    return m;
  }, [tickets, sessions]);

  const filtered = filterTickets(scoped, { query, project, status });
  const groups = filtered.reduce<Record<string, TicketSummary[]>>((acc, t) => {
    (acc[t.project ?? NO_PROJECT] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="pad">
      {tickets.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">No tickets.</p>
          <button className="btn primary block" onClick={() => setNewOpen(true)}>+ New ticket</button>
        </div>
      )}
      {tickets.length > 0 && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          statuses={statuses} activeStatus={status} onStatus={setStatus}
          mine={mine} onMine={setMine}
          placeholder="Filter tickets…"
          action={
            <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
          }
        />
      )}
      {tickets.length > 0 && filtered.length === 0 && <p className="empty">No matching tickets.</p>}
      {Object.entries(groups).map(([project, items]) => (
        <section key={project}>
          <h4 className="sect">{project}</h4>
          {groupByStatus(items, (t) => t.statusName).map((group) => (
            <div key={group.status}>
              <div className="substatus"><StatusBadge status={group.status} /></div>
              {orderTickets(group.items).map((t) => (
                <button key={t.identifier} className="card tap" onClick={() => setPicked(t)}>
                  <div>
                    <span className="id">{t.identifier}</span>
                    {showsMineMarker(t, mine) && <span className="chip mine">Mine</span>}
                    {levels.get(t.identifier) && (
                      <span
                        className={`s-dot ${levels.get(t.identifier)}`}
                        aria-label={levels.get(t.identifier) === "attn" ? "needs input" : "session running"}
                        title={levels.get(t.identifier) === "attn" ? "needs input" : "session running"}
                      />
                    )}
                  </div>
                  <div className="title">{t.title}</div>
                  {t.labels.length > 0 && (
                    <div className="meta">{t.labels.map((l) => <span key={l} className="chip">{l}</span>)}</div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </section>
      ))}
      {picked && (
        <LaunchSheet token={token} ticket={picked} sessions={sessions}
          onClose={() => setPicked(null)} onLaunched={onLaunched}
          onOpen={(s) => { setPicked(null); onOpen(s); }}
          onOpenDocs={() => { setPicked(null); onOpenDocs(picked); }} />
      )}
      {newOpen && (
        <NewTicketSheet token={token}
          onClose={() => setNewOpen(false)}
          onCreated={(meta) => { onLaunched(); onOpen(meta); }} />
      )}
    </div>
  );
}
