"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { tmuxName } from "@/server/sessionKey";
import type { SessionMeta, TicketSummary } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);

  const start = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
        autoAdvance: auto, projectName: ticket.project }),
    });
    if (res.status === 409) { setErr("A session for this ticket+status already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
        {existing ? (
          <button className="btn primary block" onClick={() => onOpen(existing)}>Open running session</button>
        ) : (
          <>
            <div className="two">
              <label className="field"><span className="lbl">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="field"><span className="lbl">Effort</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            <button className="btn primary block" onClick={start}>Start session</button>
          </>
        )}
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
