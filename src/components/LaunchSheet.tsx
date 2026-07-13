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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "#151517", width: "100%", padding: 20, paddingBottom: 32, borderRadius: "16px 16px 0 0", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
        <h3>{ticket.identifier} · {ticket.statusName}</h3>
        {existing ? (
          <button style={{ width: "100%", padding: 14 }} onClick={() => onOpen(existing)}>Open running session</button>
        ) : (
          <>
            <label>Model <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label style={{ marginLeft: 12 }}>Effort <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label style={{ display: "block", margin: "12px 0" }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            <button style={{ width: "100%", padding: 14 }} onClick={start}>Start</button>
          </>
        )}
        {err && <p style={{ color: "#f88" }}>{err}</p>}
      </div>
    </div>
  );
}
