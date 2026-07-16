"use client";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import StateBadge from "./StateBadge";
import FilterBar, { NO_PROJECT } from "./FilterBar";
import NewSessionSheet from "./NewSessionSheet";
import { usePersistedState } from "@/lib/usePersistedState";
import type { SessionMeta } from "@/server/types";
import { orderSessions } from "@/lib/orderSessions";
import { groupByStatus } from "@/lib/groupByStatus";
import StatusBadge from "./StatusBadge";

export default function SessionList(
  { token, sessions, onOpen, onChanged }:
  { token: string; sessions: SessionMeta[]; onOpen: (s: SessionMeta) => void; onChanged: () => void },
) {
  const [query, setQuery] = usePersistedState("mojito-sessions-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-sessions-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
  const [newOpen, setNewOpen] = useState(false);

  const projects = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.projectName ?? NO_PROJECT))).sort(),
    [sessions],
  );

  const q = query.trim().toLowerCase();
  const filtered = sessions.filter((s) => {
    if (project !== null && (s.projectName ?? NO_PROJECT) !== project) return false;
    if (!q) return true;
    return [s.ticket, s.launchStatus, s.model, s.message, s.title]
      .some((v) => v?.toLowerCase().includes(q));
  });
  const groups = filtered.reduce<Record<string, SessionMeta[]>>((acc, s) => {
    (acc[s.projectName ?? NO_PROJECT] ??= []).push(s);
    return acc;
  }, {});
  const dismiss = async (s: SessionMeta) => {
    const active = s.state === "running" || s.state === "needs-input" || s.state === "starting";
    const label = s.ticket || s.title;
    const prompt = active ? `Kill the running session for ${label}?` : `Dismiss the session for ${label}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  const cleanup = async () => {
    if (!confirm("Remove all orphaned sessions (their tmux is gone)?")) return;
    await apiFetch(token, "/api/sessions/sweep", { method: "POST" });
    onChanged();
  };

  const toggleAuto = async (e: React.MouseEvent, s: SessionMeta) => {
    e.stopPropagation();
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "PATCH", body: JSON.stringify({ autoAdvance: !s.autoAdvance }) });
    onChanged();
  };

  return (
    <div className="pad">
      {sessions.length > 0 && (
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          placeholder="Filter sessions…"
          action={
            <>
              <button className="btn ghost sm" onClick={() => setNewOpen(true)}>New session</button>
              <button className="btn ghost sm" onClick={cleanup}>Clean up</button>
            </>
          }
        />
      )}
      {sessions.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">No sessions.</p>
          <button className="btn primary block" onClick={() => setNewOpen(true)}>New session</button>
        </div>
      )}
      {sessions.length > 0 && filtered.length === 0 && <p className="empty">No matching sessions.</p>}
      {Object.entries(groups).map(([proj, items]) => (
        <section key={proj}>
          <h4 className="sect">{proj}</h4>
          {groupByStatus(items, (s) => s.launchStatus).map((group) => (
            <div key={group.status}>
              {group.status && <div className="substatus"><StatusBadge status={group.status} /></div>}
              {orderSessions(group.items).map((s) => {
                const active = s.state === "running" || s.state === "needs-input" || s.state === "starting";
                return (
                  <div key={s.id} className={`card${s.state === "needs-input" ? " attn" : ""}`}>
                    <div className="tap" onClick={() => onOpen(s)}>
                      {s.kind === "custom" ? (
                        <>
                          <div className="row">
                            <span className="session-title">{s.title}</span>
                            <span className="grow" />
                            <StateBadge state={s.state} />
                          </div>
                          <div className="meta"><span className="chip">custom</span></div>
                          {s.message && <div className="title">{s.message}</div>}
                        </>
                      ) : (
                        <>
                          <div className="row">
                            <span className="id">{s.ticket}</span>
                            <span className="grow" />
                            <StateBadge state={s.state} />
                          </div>
                          {s.title && <div className="session-title">{s.title}</div>}
                          {s.message && <div className="title">{s.message}</div>}
                        </>
                      )}
                      <div className="meta">
                        <span className="chip">{s.model} · {s.effort}</span>
                        {s.kind === "rebase" && <span className="chip">rebase</span>}
                        {s.kind === "lime" && (
                          <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                            auto: {s.autoAdvance ? "on" : "off"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn ghost sm grow" onClick={() => onOpen(s)}>Open</button>
                      <button className={`btn sm${active ? " danger" : ""}`} onClick={() => dismiss(s)}>
                        {active ? "Kill" : "Dismiss"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {newOpen && <NewSessionSheet token={token} onClose={() => setNewOpen(false)} onLaunched={onChanged} />}
    </div>
  );
}
