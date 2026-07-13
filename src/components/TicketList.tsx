"use client";
import { useState } from "react";
import LaunchSheet from "./LaunchSheet";
import type { SessionMeta, TicketSummary } from "@/server/types";

export default function TicketList(
  { token, tickets, sessions, onLaunched, onOpen }:
  { token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const groups = tickets.reduce<Record<string, TicketSummary[]>>((acc, t) => {
    (acc[t.project ?? "No project"] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="pad">
      {Object.entries(groups).map(([project, items]) => (
        <section key={project}>
          <h4 className="sect">{project}</h4>
          {items.map((t) => (
            <button key={t.identifier} className="card tap" onClick={() => setPicked(t)}>
              <div><span className="id">{t.identifier}</span> <span className="status">· {t.statusName}</span></div>
              <div className="title">{t.title}</div>
              {t.labels.length > 0 && (
                <div className="meta">{t.labels.map((l) => <span key={l} className="chip">{l}</span>)}</div>
              )}
            </button>
          ))}
        </section>
      ))}
      {picked && (
        <LaunchSheet token={token} ticket={picked} sessions={sessions}
          onClose={() => setPicked(null)} onLaunched={onLaunched} onOpen={(s) => { setPicked(null); onOpen(s); }} />
      )}
    </div>
  );
}
