"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { resolveEffort, resolveModel, MODELS, EFFORTS } from "@/lib/stageDefaults";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { tmuxName, rebaseSessionName } from "@/server/sessionKey";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
import StateBadge from "./StateBadge";
import QaVerdictButtons from "./QaVerdictButtons";
import type { SessionMeta, TicketSummary } from "@/server/types";

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const { defaults } = useStageDefaults(token);
  // Pre-fill the model + effort optimal for this ticket's stage (overridable via the selectors).
  const [model, setModel] = useState<string>(() => resolveModel(ticket.statusName));
  const [effort, setEffort] = useState<string>(() => resolveEffort(ticket.statusName));
  const [touched, setTouched] = useState(false);
  // Re-seed both selectors from the effective (possibly user-edited) defaults once they load,
  // unless the user has already changed a selector this session.
  useEffect(() => {
    if (touched) return;
    setModel(resolveModel(ticket.statusName, defaults));
    setEffort(resolveEffort(ticket.statusName, defaults));
  }, [defaults, ticket.statusName, touched]);
  const [auto, setAuto] = useState(true);
  const [bareMode, setBareMode] = useState<"claude" | "terminal">("claude");
  const [err, setErr] = useState<string | null>(null);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);
  const existingActive = existing != null
    && (existing.state === "running" || existing.state === "needs-input" || existing.state === "starting");

  // To QA is resolved as a pure Linear mutation — no session is ever launched.
  const submitVerdict = async (arg: "approve" | "reject", reason?: string) => {
    const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/verdict`, {
      method: "POST",
      body: JSON.stringify(reason === undefined ? { arg } : { arg, reason }),
    });
    if (res.ok) { onLaunched(); onClose(); return; }
    let message = `verdict failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* non-JSON */ }
    setErr(message);
  };

  // Launch a one-off session that rebases the ticket's worktree branch (To-QA action).
  const startRebase = async () => {
    const rebaseId = rebaseSessionName(ticket.identifier);
    // A finished rebase session keeps the same tmux name — clear it before relaunching,
    // else the server rejects the launch as a duplicate.
    if (sessions.some((s) => s.id === rebaseId)) {
      await apiFetch(token, `/api/sessions/${rebaseId}`, { method: "DELETE" });
    }
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      // effort is fixed at "xhigh" (not the To-QA state default, which is "low") — a rebase
      // is an analytical task regardless of the ticket's stage-default effort.
      body: JSON.stringify({ kind: "rebase", ticket: ticket.identifier, model, effort: "xhigh",
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
    });
    if (res.status === 409) { setErr("A rebase session for this ticket already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  const noActiveSession = activeSessionLevel(ticket.identifier, sessions) === null;

  // Launch a claude session. trailingArg carries the To Merge mode (local|mr) when present.
  const start = async (trailingArg?: "local" | "mr") => {
    // A finished session for this ticket+status keeps the same tmux name, so clear it first
    // (kill + deregister) before relaunching, else the server rejects the launch as a duplicate.
    if (existing) await apiFetch(token, `/api/sessions/${existing.id}`, { method: "DELETE" });
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
        autoAdvance: auto, projectName: ticket.project, title: ticket.title, labels: ticket.labels,
        ...(trailingArg ? { trailingArg } : {}) }),
    });
    if (res.status === 409) { setErr("A session for this ticket+status already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  // Launch a bare, ticket-scoped custom session (RIC-128). Opens in the ticket's worktree if one
  // exists (else the repo root). Custom ids are random-suffixed, so no need to clear an existing one.
  const startCustom = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "custom", ticket: ticket.identifier, status: ticket.statusName,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels, model, effort }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  // Launch a plain zsh terminal in the ticket's worktree (RIC-155). Like startCustom, shell ids
  // are random-suffixed, so there is no existing session to clear first.
  const startShell = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "shell", ticket: ticket.identifier, status: ticket.statusName,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  const isToQa = ticket.statusName === "To QA";
  const isToMerge = ticket.statusName === "To Merge";

  const selectors = (
    <div className="two">
      <label className="field"><span className="lbl">Model</span>
        <select value={model} onChange={(e) => { setModel(e.target.value); setTouched(true); }}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="field"><span className="lbl">Effort</span>
        <select value={effort} onChange={(e) => { setEffort(e.target.value); setTouched(true); }}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
    </div>
  );
  const customBtn = (
    <div style={{ marginTop: 12 }}>
      <div className="btns" style={{ marginBottom: 8 }}>
        <button className={`btn ${bareMode === "claude" ? "primary" : "ghost"}`} onClick={() => setBareMode("claude")}>Claude</button>
        <button className={`btn ${bareMode === "terminal" ? "primary" : "ghost"}`} onClick={() => setBareMode("terminal")}>Terminal</button>
      </div>
      {bareMode === "claude"
        ? <button className="btn ghost block" onClick={() => startCustom()}>Custom session</button>
        : <button className="btn ghost block" onClick={() => startShell()}>Start terminal</button>}
    </div>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
        {ticket.title && <p className="sheet-title">{ticket.title}</p>}
        {isToQa ? (
          <>
            <QaVerdictButtons onApprove={() => submitVerdict("approve")} onReject={(reason) => submitVerdict("reject", reason)} />
            {noActiveSession && (
              <button className="btn ghost block" style={{ marginTop: 12 }} onClick={startRebase}>
                Rebase onto default branch
              </button>
            )}
            {selectors}
            {customBtn}
          </>
        ) : existingActive ? (
          <>
            <button className="btn primary block" onClick={() => onOpen(existing!)}>Open running session</button>
            {selectors}
            {customBtn}
          </>
        ) : (
          <>
            {existing && (
              <button className="btn ghost block" style={{ marginBottom: 12 }} onClick={() => onOpen(existing)}>
                Open session (<StateBadge state={existing.state} />)
              </button>
            )}
            {selectors}
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            {isToMerge ? (
              <div className="btns">
                <button className="btn primary" onClick={() => start("local")}>Start · local</button>
                <button className="btn primary" onClick={() => start("mr")}>Start · mr</button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => start()}>{existing ? "Start new session" : "Start session"}</button>
            )}
            {customBtn}
          </>
        )}
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
