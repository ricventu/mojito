"use client";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client";
import StateBadge from "./StateBadge";
import FilterBar, { NO_PROJECT } from "./FilterBar";
import type { SessionMeta } from "@/server/types";

export default function SessionList(
  { token, sessions, onOpen, onChanged }:
  { token: string; sessions: SessionMeta[]; onOpen: (s: SessionMeta) => void; onChanged: () => void },
) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);

  const projects = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.projectName ?? NO_PROJECT))).sort(),
    [sessions],
  );

  const q = query.trim().toLowerCase();
  const filtered = sessions.filter((s) => {
    if (project !== null && (s.projectName ?? NO_PROJECT) !== project) return false;
    if (!q) return true;
    return [s.ticket, s.launchStatus, s.model, s.message]
      .some((v) => v?.toLowerCase().includes(q));
  });
  const groups = filtered.reduce<Record<string, SessionMeta[]>>((acc, s) => {
    (acc[s.projectName ?? NO_PROJECT] ??= []).push(s);
    return acc;
  }, {});
  const dismiss = async (s: SessionMeta) => {
    const active = s.state === "running" || s.state === "needs-input" || s.state === "starting";
    const prompt = active
      ? `Kill the running session for ${s.ticket}?`
      : `Dismiss the session for ${s.ticket}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
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
        />
      )}
      {sessions.length === 0 && <p className="empty">No sessions.</p>}
      {sessions.length > 0 && filtered.length === 0 && <p className="empty">No matching sessions.</p>}
      {Object.entries(groups).map(([proj, items]) => (
        <section key={proj}>
          <h4 className="sect">{proj}</h4>
          {items.map((s) => {
            const active = s.state === "running" || s.state === "needs-input" || s.state === "starting";
            return (
              <div key={s.id} className={`card${s.state === "needs-input" ? " attn" : ""}`}>
                <div className="tap" onClick={() => onOpen(s)}>
                  <div className="row">
                    <span className="id">{s.ticket}</span>
                    <span className="grow" />
                    <StateBadge state={s.state} />
                  </div>
                  <div className="status">{s.launchStatus}</div>
                  {s.message && <div className="title">{s.message}</div>}
                  <div className="meta">
                    <span className="chip">{s.model} · {s.effort}</span>
                    <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                      auto: {s.autoAdvance ? "on" : "off"}
                    </button>
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
        </section>
      ))}
    </div>
  );
}
