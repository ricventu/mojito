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
    <div style={{ padding: 12 }}>
      {Object.entries(groups).map(([project, items]) => (
        <section key={project}>
          <h4 style={{ opacity: 0.6 }}>{project}</h4>
          {items.map((t) => (
            <button key={t.identifier} onClick={() => setPicked(t)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: 14, margin: "8px 0", background: "#151517", border: "1px solid #222", borderRadius: 12 }}>
              <strong>{t.identifier}</strong> · {t.statusName}
              <div>{t.title}</div>
              {t.labels.length > 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>{t.labels.join(", ")}</div>}
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
