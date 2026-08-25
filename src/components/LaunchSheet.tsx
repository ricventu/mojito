"use client";
import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { apiError } from "@/lib/apiError";
import { resolveEffort, resolveModel, MODELS, EFFORTS } from "@/lib/stageDefaults";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { tmuxName } from "@/server/sessionKey";
import StateBadge from "./StateBadge";
import TicketLink from "./TicketLink";
import { Choice } from "./ui/choice";
import { Combobox } from "./ui/combobox";
import { worktreeOptions } from "@/lib/worktreeOptions";
import {
  baseBranchOptions, canPickWorktree, launchWorktreeFields, reconcileBaseBranch, worktreeAnswer,
  type WorktreeAnswer, type WorktreeStatus,
} from "@/lib/worktreeChoice";
import QaVerdictButtons from "./QaVerdictButtons";
import type { SessionMeta, TicketSummary } from "@/server/types";
import { holdsSheetOpen, type HeldOutcome } from "@/lib/verdictOutcome";
import { qaGateModel, type MergeState } from "@/lib/qaGate";
import { qaSessionModel } from "@/lib/qaSession";
import { launchedSession } from "@/lib/launchedSession";
import { isActiveSession } from "@/lib/activeSession";

// Shared by all three launch handlers: the only part of their shape that would drift if
// copied. A thrown fetch is the case that used to show the user nothing at all.
const LAUNCH_FAILED = "launch request failed — check the connection and retry";

// "There is nothing to ask": what an unreachable or unreadable worktree check degrades to,
// which is the behaviour from before the question existed — launch in whatever cwd the
// server resolves, create nothing.
const NO_QUESTION: WorktreeStatus =
  { exists: true, branches: [], remoteBranches: [], defaultBranch: null, worktrees: [] };

// Every list is normalized rather than trusted: a server that predates one of these fields
// answers without it, and an absent list means exactly what an empty one does to the sheet
// ("nothing to offer"), where an undefined one would throw inside the selects.
function parseWorktreeStatus(data: unknown): WorktreeStatus {
  const d = data as Partial<WorktreeStatus> | null;
  if (!d || typeof d.exists !== "boolean") return NO_QUESTION;
  return {
    exists: d.exists,
    branches: Array.isArray(d.branches) ? d.branches : [],
    remoteBranches: Array.isArray(d.remoteBranches) ? d.remoteBranches : [],
    defaultBranch: typeof d.defaultBranch === "string" ? d.defaultBranch : null,
    worktrees: Array.isArray(d.worktrees) ? d.worktrees : [],
  };
}

// The two worktree endpoints take the same pair, and the title is what locates the ticket's
// own worktree by its slugged path — an omitted one looks like a different worktree.
function worktreeQuery(ticket: TicketSummary): string {
  const qs = new URLSearchParams({ title: ticket.title ?? "" });
  if (ticket.project) qs.set("projectName", ticket.project);
  return qs.toString();
}

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen, onOpenDocs }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void; onOpenDocs: () => void },
) {
  const isToQa = ticket.statusName === "To QA";
  // A To QA launch is a work session (Task 7 gives it the work id), so it takes the work
  // profile rather than the app-wide fallback.
  const stageKey = isToQa ? "In Progress" : ticket.statusName;
  const { defaults } = useStageDefaults(token);
  // Pre-fill the model + effort optimal for this ticket's stage (overridable via the selectors).
  const [model, setModel] = useState<string>(() => resolveModel(stageKey));
  const [effort, setEffort] = useState<string>(() => resolveEffort(stageKey));
  const [touched, setTouched] = useState(false);
  // Re-seed both selectors from the effective (possibly user-edited) defaults once they load,
  // unless the user has already changed a selector this session.
  useEffect(() => {
    if (touched) return;
    setModel(resolveModel(stageKey, defaults));
    setEffort(resolveEffort(stageKey, defaults));
  }, [defaults, stageKey, touched]);
  const [err, setErr] = useState<string | null>(null);
  const [verdictPending, setVerdictPending] = useState<"approve-local" | "approve-mr" | "mark-done" | null>(null);
  const [mergeState, setMergeState] = useState<MergeState>("checking");
  // Whether the ticket already has a worktree, checked once per ticket. "loading" lets the
  // launch buttons show immediately rather than flash in after the fetch — only a confirmed
  // exists:false gates them behind the create-worktree question below.
  const [wtStatus, setWtStatus] = useState<"loading" | WorktreeStatus>("loading");
  const [wtAnswer, setWtAnswer] = useState<WorktreeAnswer | null>(null);
  useEffect(() => {
    let live = true;
    setWtStatus("loading");
    setWtAnswer(null);
    (async () => {
      try {
        const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/worktree-status?${worktreeQuery(ticket)}`);
        const data = res.ok ? await res.json() : null;
        if (live) setWtStatus(parseWorktreeStatus(data));
      } catch {
        // Unreachable check degrades to "exists" — skip the question, same as before it existed.
        if (live) setWtStatus(NO_QUESTION);
      }
    })();
    return () => { live = false; };
  }, [token, ticket.identifier, ticket.project, ticket.title]);
  const needsWorktreeChoice = wtStatus !== "loading" && !wtStatus.exists && wtAnswer === null;
  const canLaunch = !needsWorktreeChoice;
  // Ask the server whether anything is left to merge before offering to merge it. A failed or
  // unreachable check degrades to the ordinary approve buttons — never to a dead gate.
  useEffect(() => {
    if (!isToQa) return;
    let live = true;
    (async () => {
      try {
        const qs = ticket.project ? `?projectName=${encodeURIComponent(ticket.project)}` : "";
        const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/merge-state${qs}`);
        const nothing = res.ok && (await res.json())?.nothingToMerge === true;
        if (live) setMergeState(nothing ? "nothing-to-merge" : "mergeable");
      } catch {
        if (live) setMergeState("mergeable");
      }
    })();
    return () => { live = false; };
  }, [isToQa, token, ticket.identifier, ticket.project]);
  // One state for all three launch buttons, mirroring how a single verdictPending covers
  // the three verdict buttons. The ticket launch is the slow one: its POST runs a Linear
  // fetch and then downloads the ticket's assets before it answers, seconds during which
  // the button used to look dead.
  const [launching, setLaunching] = useState<"work" | "custom" | "shell" | null>(null);
  const launchBusy = launching !== null;
  // Set only for the two outcomes that carry information the user cannot get from the
  // board or the session list: the MR URL, and the fact that a merge conflict happened.
  // The other two close the sheet, as they always have.
  const [outcome, setOutcome] = useState<HeldOutcome | null>(null);
  // Mirrors ticket.assignedToMe so the sheet can flip the label without waiting for the
  // list to refetch — the ticket prop is a snapshot taken when the sheet opened.
  const [mine, setMine] = useState(ticket.assignedToMe);
  const [assigning, setAssigning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);
  // The single active-state definition, not a fourth hand-copied list of states.
  const existingActive = existing != null && isActiveSession(existing);
  // What the To QA branch offers for the work session: open it while it is registered, and
  // start a replacement whenever it is not alive. start() clears a dead registration first,
  // so both can be on screen at once.
  const qaSession = qaSessionModel({ registered: existing != null, active: existingActive });

  // The To QA verdict is resolved server-side: approve merges (or opens an MR) with no
  // session at all, and only a merge conflict spawns one. projectName and title are sent
  // because the server needs them to locate the worktree and to seed a fix session.
  const submitVerdict = async (arg: "approve-local" | "approve-mr" | "mark-done") => {
    setErr(null);
    setVerdictPending(arg);
    try {
      const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/verdict`, {
        method: "POST",
        body: JSON.stringify({ arg, projectName: ticket.project, title: ticket.title }),
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
      setErr(await apiError(res, "verdict failed"));
    } catch {
      setErr("verdict request failed — check the connection and retry");
    } finally {
      setVerdictPending(null);
    }
  };

  // Refresh the remote-tracking refs and the list built from them, for the case the base
  // branch select cannot fix by itself: `origin/main` is only as new as the last fetch, so a
  // pick made without this branches off a base that merely looks current. The answer replaces
  // the whole status — a fetch can also reveal a branch created since the sheet opened — and
  // the answer's own warning is shown beside the list, which stays usable either way.
  const fetchRemotes = async () => {
    setErr(null);
    setFetching(true);
    try {
      const res = await apiFetch(token, `/api/tickets/${ticket.identifier}/worktree-fetch?${worktreeQuery(ticket)}`,
        { method: "POST" });
      if (!res.ok) { setErr(await apiError(res, "fetch failed")); return; }
      const body = await res.json();
      const next = parseWorktreeStatus(body?.status);
      setWtStatus(next);
      setWtAnswer((a) => reconcileBaseBranch(a, next));
      if (body?.warning) setErr(String(body.warning));
    } catch {
      setErr("fetch request failed — check the connection and retry");
    } finally {
      setFetching(false);
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

  // Every launch ends inside the session it just started: starting a session is a request to
  // work in it, not to go back to the board. The 201 body is the registered session, so the
  // terminal opens on it directly without waiting for the list to refetch. A body we cannot
  // read (older server, rewritten response) falls back to the old behaviour — close the sheet.
  const enter = async (res: Response) => {
    onLaunched();
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* fall through to onClose */ }
    const opened = launchedSession(payload);
    if (opened) onOpen(opened);
    else onClose();
  };

  // Launch a claude session.
  const start = async () => {
    setErr(null);
    setLaunching("work");
    try {
      // No preemptive DELETE: this used to kill whatever held the ticket's tmux name so the
      // relaunch could take it, which meant "Start" silently ended a session claude was still
      // sitting in. Ending a session is the Kill button's job alone. A dead registration is no
      // obstacle (launchSession overwrites it); only a LIVE tmux is, and that answers 409 below.
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels,
          ...launchWorktreeFields(wtAnswer) }),
      });
      if (res.status === 409) {
        setErr("That session is still alive — open it, or kill it from its terminal, before starting a new one.");
        return;
      }
      if (!res.ok) { setErr(await apiError(res, "launch failed")); return; }
      await enter(res);
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };

  // Launch a bare, ticket-scoped custom session (RIC-128). Opens in the ticket's worktree if one
  // exists (else the repo root). Custom ids are random-suffixed, so no need to clear an existing one.
  const startCustom = async () => {
    setErr(null);
    setLaunching("custom");
    try {
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ kind: "custom", ticket: ticket.identifier, status: ticket.statusName,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels, model, effort,
          ...launchWorktreeFields(wtAnswer) }),
      });
      if (!res.ok) { setErr(await apiError(res, "launch failed")); return; }
      await enter(res);
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };

  // Launch a plain zsh terminal in the ticket's worktree (RIC-155). Like startCustom, shell ids
  // are random-suffixed, so there is no existing session to clear first.
  const startShell = async () => {
    setErr(null);
    setLaunching("shell");
    try {
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ kind: "shell", ticket: ticket.identifier, status: ticket.statusName,
          projectName: ticket.project, title: ticket.title, labels: ticket.labels,
          ...launchWorktreeFields(wtAnswer) }),
      });
      if (!res.ok) { setErr(await apiError(res, "terminal failed")); return; }
      await enter(res);
    } catch {
      setErr(LAUNCH_FAILED);
    } finally {
      setLaunching(null);
    }
  };

  // Divs, not labels: the fields are buttons now (see ui/choice), which a <label>
  // cannot be the label of.
  const selectors = (
    <div className="two">
      <div className="field"><span className="lbl">Model</span>
        <Choice label="Model" value={model} options={MODELS}
          onChange={(v) => { setModel(v); setTouched(true); }} /></div>
      <div className="field"><span className="lbl">Effort</span>
        <Choice label="Effort" value={effort} options={EFFORTS}
          onChange={(v) => { setEffort(v); setTouched(true); }} /></div>
    </div>
  );
  // One tap per action: a bare Claude session or a plain terminal in the ticket's
  // worktree — direct, self-describing buttons instead of a mode toggle.
  const customBtn = (
    <div className="btns" style={{ marginTop: 12 }}>
      <button className="btn ghost" disabled={launchBusy} onClick={() => startCustom()}>
        {launching === "custom" ? "Starting…" : "Claude session"}
      </button>
      <button className="btn ghost" disabled={launchBusy} onClick={() => startShell()}>
        {launching === "shell" ? "Opening…" : "Terminal"}
      </button>
    </div>
  );
  // Asked once per ticket, only when it has no worktree yet: replaces the launch buttons
  // until answered, so a session never opens in a spot the human didn't choose. "No"
  // launches into the repo root exactly like before this existed, and asks again next time
  // (nothing was created); "Yes" pins a base branch that rides along with the launch;
  // "Existing" opens one of the worktrees the repo already has (RIC-243) — three labels
  // this short because `.btns` gives each an equal third of a sheet that is 320px wide on
  // the narrowest phone, and a longer one wraps inside its own button.
  const worktreeChoice = needsWorktreeChoice ? (
    <div className="field" style={{ marginTop: 12 }}>
      <span className="lbl">Create a worktree for this ticket?</span>
      <div className="btns" style={{ marginTop: 4 }}>
        <button className="btn sm ghost" onClick={() => setWtAnswer(worktreeAnswer("no", wtStatus))}>No</button>
        {/* Offered only when there is something to open — a button onto an empty select
            is worse than no button (RIC-243). */}
        {canPickWorktree(wtStatus) && (
          <button className="btn sm ghost" onClick={() => setWtAnswer(worktreeAnswer("pick", wtStatus))}>Existing</button>
        )}
        <button className="btn sm primary" onClick={() => setWtAnswer(worktreeAnswer("create", wtStatus))}>Yes</button>
      </div>
    </div>
  ) : null;
  // Searchable rather than a Choice: with the remote-tracking branches in it the list is
  // roughly twice as long as the repo has branches, well past what a plain menu is scannable
  // at. Remote refs read as `origin/main` next to a bare `main`, so nothing labels them.
  const baseBranchSelect = wtAnswer?.kind === "create" && wtStatus !== "loading" ? (
    <div className="field" style={{ marginTop: 12 }}>
      <div className="lbl-row">
        <span className="lbl">Base branch</span>
        {/* Offered only when there is a remote-tracking branch to refresh: on a repo with no
            remote a fetch has nothing to do, and the action would just be noise. */}
        {wtStatus.remoteBranches.length > 0 && (
          <button className="btn sm ghost with-icon" onClick={fetchRemotes} disabled={fetching}
            title="Fetch the remotes, so a remote base is the current one">
            <RotateCw size={13} aria-hidden="true" />
            {fetching ? "Fetching…" : "Fetch"}
          </button>
        )}
      </div>
      <Combobox label="Base branch" searchLabel="Search branches…" emptyLabel="No branch matches."
        options={baseBranchOptions(wtStatus).map((b) => ({ value: b, label: b }))}
        value={wtAnswer.baseBranch}
        onChange={(v) => setWtAnswer({ kind: "create", baseBranch: v, worktree: "" })} />
    </div>
  ) : null;
  // Searchable rather than a Choice: the list is as long as the repo has worktrees, and
  // branch names are long enough that scanning them wants a filter.
  const worktreeSelect = wtAnswer?.kind === "pick" && wtStatus !== "loading" ? (
    <div className="field" style={{ marginTop: 12 }}><span className="lbl">Worktree</span>
      <Combobox label="Worktree" searchLabel="Search worktrees…" emptyLabel="No worktree matches."
        options={worktreeOptions(wtStatus.worktrees)} value={wtAnswer.worktree}
        onChange={(v) => setWtAnswer({ kind: "pick", baseBranch: "", worktree: v })} />
    </div>
  ) : null;

  // The fix session is registered before the verdict responds, so the onLaunched()
  // refetch normally has it by the time this renders — but the prop update is a round trip
  // behind, so the button says what it is waiting for instead of silently doing nothing.
  // Looking the session up by id in the live list is how page.tsx opens alerts, too.
  // If that one onLaunched() refresh happens to fail, it is not the only rescue: the
  // fix session emits hook events as Claude starts, and useEvents' SSE handler
  // (src/app/page.tsx) calls refreshSessions() on every event, so the list — and this
  // button — self-heals within seconds without any retry logic here.
  const fixSession = outcome?.done === "fix-session"
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
          <h3><TicketLink id={ticket.identifier} url={ticket.url} /> <span className="chip">{ticket.statusName}</span></h3>
          {outcome.done === "mr-created" ? (
            <div className="outcome">
              <p className="outcome-head">MR opened · {ticket.identifier} moved to Done</p>
              <a className="outcome-link" href={outcome.url} target="_blank" rel="noreferrer">{outcome.url}</a>
            </div>
          ) : (
            <div className="outcome warn">
              <p className="outcome-head">Merge not completed automatically</p>
              <p className="outcome-body">
                A fix session was launched to finish the approved merge; {ticket.identifier} moves
                to Done when it reports the merge as completed.
              </p>
              {outcome.detail && <p className="outcome-body mono">{outcome.detail}</p>}
              <button className="btn primary block" style={{ marginTop: 12 }}
                disabled={!fixSession}
                onClick={() => fixSession && onOpen(fixSession)}>
                {fixSession ? "Open fix session" : "Starting…"}
              </button>
            </div>
          )}
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    // Ignore the backdrop tap while a launch is in flight: unmounting the sheet mid-launch
    // would drop the later setErr(...) on the floor, leaving a failed launch reporting nothing.
    <div className="sheet-backdrop" onClick={launchBusy ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><TicketLink id={ticket.identifier} url={ticket.url} /> <span className="chip">{ticket.statusName}</span></h3>
        {ticket.title && <p className="sheet-title">{ticket.title}</p>}
        {isToQa ? (
          <>
            <QaVerdictButtons
              pending={verdictPending}
              gate={qaGateModel(mergeState)}
              onApprove={(a) => submitVerdict(a)}
              onMarkDone={() => submitVerdict("mark-done")}
            />
            {err && <p className="err-text">{err}</p>}
            {/* QA rework happens in the session that built the branch, so the sheet's job at
                To QA is to get you into it — or to replace it if it died. */}
            {qaSession.open && existing && (
              <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => onOpen(existing)}>
                Open session (<StateBadge state={existing.state} />)
              </button>
            )}
            {worktreeChoice}
            {baseBranchSelect}
            {worktreeSelect}
            {qaSession.start && canLaunch && (
              <button className="btn primary block" style={{ marginTop: 12 }} disabled={launchBusy} onClick={() => start()}>
                {launching === "work" ? "Starting…" : existing ? "Start new work session" : "Start work session"}
              </button>
            )}
            {selectors}
            {canLaunch && customBtn}
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
            {worktreeChoice}
            {baseBranchSelect}
            {worktreeSelect}
            {canLaunch && (
              <button className="btn primary block" disabled={launchBusy} onClick={() => start()}>
                {launching === "work" ? "Starting…" : existing ? "Start new session" : "Start session"}
              </button>
            )}
            {canLaunch && customBtn}
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
