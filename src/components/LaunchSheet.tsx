"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { resolveEffort, resolveModel, MODELS, EFFORTS } from "@/lib/stageDefaults";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { tmuxName } from "@/server/sessionKey";
import StateBadge from "./StateBadge";
import QaVerdictButtons from "./QaVerdictButtons";
import type { SessionMeta, TicketSummary } from "@/server/types";
import { holdsSheetOpen, type HeldOutcome } from "@/lib/verdictOutcome";

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen, onOpenDocs }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void; onOpenDocs: () => void },
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
  const [err, setErr] = useState<string | null>(null);
  const [verdictPending, setVerdictPending] = useState<"approve-local" | "approve-mr" | "reject" | null>(null);
  // Set only for the two outcomes that carry information the user cannot get from the
  // board or the session list: the MR URL, and the fact that a merge conflict happened.
  // The other two close the sheet, as they always have.
  const [outcome, setOutcome] = useState<HeldOutcome | null>(null);
  // Mirrors ticket.assignedToMe so the sheet can flip the label without waiting for the
  // list to refetch — the ticket prop is a snapshot taken when the sheet opened.
  const [mine, setMine] = useState(ticket.assignedToMe);
  const [assigning, setAssigning] = useState(false);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);
  const existingActive = existing != null
    && (existing.state === "running" || existing.state === "needs-input" || existing.state === "starting");

  // The To QA verdict is resolved server-side: approve merges (or opens an MR) with
  // no session at all, and only reject (or a merge conflict) spawns one. projectName
  // and title are sent because the server needs them to locate the worktree and to seed
  // whatever session the verdict ends up launching.
  const submitVerdict = async (arg: "approve-local" | "approve-mr" | "reject", reason?: string) => {
    // The server-side rebase+merge takes 10s+; without a pending state the click looks
    // like a no-op and closing the sheet aborts the request mid-merge.
    setErr(null);
    setVerdictPending(arg);
    try {
      const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/verdict`, {
        method: "POST",
        body: JSON.stringify({ arg, ...(reason === undefined ? {} : { reason }),
          projectName: ticket.project, title: ticket.title }),
      });
      if (res.ok) {
        // Refresh either way: every verdict moves the board, launches a session, or both.
        onLaunched();
        let result: unknown = null;
        try { result = (await res.json())?.result; } catch { /* keep null and just close */ }
        if (holdsSheetOpen(result)) setOutcome(result);
        else onClose();
        return;
      }
      let message = `verdict failed (${res.status})`;
      try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* non-JSON */ }
      setErr(message);
    } catch {
      setErr("verdict request failed — check the connection and retry");
    } finally {
      setVerdictPending(null);
    }
  };

  // Take the ticket or hand it back. The sheet stays open — assigning a ticket and then
  // starting its session is one flow.
  const toggleAssignee = async () => {
    const next = !mine;
    setAssigning(true);
    setMine(next);
    const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/assignee`, {
      method: "POST",
      body: JSON.stringify({ mine: next }),
    });
    setAssigning(false);
    if (!res.ok) {
      setMine(!next);
      setErr(`could not ${next ? "assign" : "unassign"} ${ticket.identifier} (${res.status})`);
      return;
    }
    setErr(null);
    onLaunched();
  };

  // Launch a claude session.
  const start = async () => {
    // A finished session for this ticket+status keeps the same tmux name, so clear it first
    // (kill + deregister) before relaunching, else the server rejects the launch as a duplicate.
    if (existing) await apiFetch(token, `/api/sessions/${existing.id}`, { method: "DELETE" });
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
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

  const selectors = (
    <div className="two">
      <label className="field"><span className="lbl">Model</span>
        <select value={model} onChange={(e) => { setModel(e.target.value); setTouched(true); }}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="field"><span className="lbl">Effort</span>
        <select value={effort} onChange={(e) => { setEffort(e.target.value); setTouched(true); }}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
    </div>
  );
  // One tap per action: a bare Claude session or a plain terminal in the ticket's
  // worktree — direct, self-describing buttons instead of a mode toggle.
  const customBtn = (
    <div className="btns" style={{ marginTop: 12 }}>
      <button className="btn ghost" onClick={() => startCustom()}>Claude session</button>
      <button className="btn ghost" onClick={() => startShell()}>Terminal</button>
    </div>
  );

  // The conflict session is registered before the verdict responds, so the onLaunched()
  // refetch normally has it by the time this renders — but the prop update is a round trip
  // behind, so the button says what it is waiting for instead of silently doing nothing.
  // Looking the session up by id in the live list is how page.tsx opens alerts, too.
  // If that one onLaunched() refresh happens to fail, it is not the only rescue: the
  // conflict session emits hook events as Claude starts, and useEvents' SSE handler
  // (src/app/page.tsx) calls refreshSessions() on every event, so the list — and this
  // button — self-heals within seconds without any retry logic here.
  const conflictSession = outcome?.done === "conflict-session"
    ? sessions.find((s) => s.id === outcome.sessionId)
    : undefined;

  if (outcome) {
    // This backdrop is intentionally inert (no onClick): unlike the main return below,
    // this panel holds the only copy of the MR URL / conflict notice anywhere in the UI,
    // and there is no undo. A stray tap on the dead zone above the sheet must not be able
    // to discard it — dismissal requires the explicit Close button.
    return (
      <div className="sheet-backdrop">
        <div className="sheet">
          <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
          {outcome.done === "mr-created" ? (
            <div className="outcome">
              <p className="outcome-head">MR opened · {ticket.identifier} moved to Done</p>
              <a className="outcome-link" href={outcome.url} target="_blank" rel="noreferrer">{outcome.url}</a>
            </div>
          ) : (
            <div className="outcome warn">
              <p className="outcome-head">Merge conflict — the branch was not merged</p>
              <p className="outcome-body">
                The rebase stopped on a conflict, so {ticket.identifier} stays at To QA.
                A conflict session was launched to resolve it.
              </p>
              <button className="btn primary block" style={{ marginTop: 12 }}
                disabled={!conflictSession}
                onClick={() => conflictSession && onOpen(conflictSession)}>
                {conflictSession ? "Open conflict session" : "Starting…"}
              </button>
            </div>
          )}
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
        {ticket.title && <p className="sheet-title">{ticket.title}</p>}
        {isToQa ? (
          <>
            <QaVerdictButtons pending={verdictPending} onApprove={(a) => submitVerdict(a)} onReject={(reason) => submitVerdict("reject", reason)} />
            {err && <p className="err-text">{err}</p>}
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
            <button className="btn primary block" onClick={() => start()}>{existing ? "Start new session" : "Start session"}</button>
            {customBtn}
          </>
        )}
        <button className="btn ghost block" style={{ marginTop: 12 }} disabled={assigning} onClick={toggleAssignee}>
          {mine ? "Unassign" : "Assign to me"}
        </button>
        <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onOpenDocs}>Docs</button>
        {!isToQa && err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
