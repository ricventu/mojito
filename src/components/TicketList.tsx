"use client";
import { useMemo, useState } from "react";
import LaunchSheet from "./LaunchSheet";
import NewTicketSheet from "./NewTicketSheet";
import FilterBar, { NO_PROJECT } from "./FilterBar";
import { usePersistedState } from "@/lib/usePersistedState";
import type { SessionMeta, TicketSummary } from "@/server/types";
import { activeSessionLevel, type ActiveLevel } from "@/lib/ticketSessionLevel";
import { groupByStatus } from "@/lib/groupByStatus";
import { orderTickets } from "@/lib/orderTickets";
import StatusBadge from "./StatusBadge";

export default function TicketList(
  { token, tickets, sessions, onLaunched, onOpen }:
  { token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const [query, setQuery] = usePersistedState("mojito-tickets-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-tickets-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
  const [newOpen, setNewOpen] = useState(false);

  const projects = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.project ?? NO_PROJECT))).sort(),
    [tickets],
  );

  const levels = useMemo(() => {
    const m = new Map<string, ActiveLevel>();
    for (const t of tickets) {
      const level = activeSessionLevel(t.identifier, sessions);
      if (level) m.set(t.identifier, level);
    }
    return m;
  }, [tickets, sessions]);

  const q = query.trim().toLowerCase();
  const filtered = tickets.filter((t) => {
    if (project !== null && (t.project ?? NO_PROJECT) !== project) return false;
    if (!q) return true;
    return [t.identifier, t.title, t.statusName, ...t.labels]
      .some((v) => v.toLowerCase().includes(q));
  });
  const groups = filtered.reduce<Record<string, TicketSummary[]>>((acc, t) => {
    (acc[t.project ?? NO_PROJECT] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
      </div>
      {tickets.length > 0 && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          placeholder="Filter tickets…"
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
          onClose={() => setPicked(null)} onLaunched={onLaunched} onOpen={(s) => { setPicked(null); onOpen(s); }} />
      )}
      {newOpen && (
        <NewTicketSheet token={token}
          onClose={() => setNewOpen(false)}
          onCreated={(meta) => { onLaunched(); onOpen(meta); }} />
      )}
    </div>
  );
}
