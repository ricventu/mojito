"use client";
import { useState } from "react";
import {
  ArrowDownToLine, ArrowUpToLine, FileTerminal, Play, Rocket, ScrollText, Square, X,
} from "lucide-react";
import { apiFetch } from "@/lib/client";
import { projectActions, type ProjectAction } from "@/lib/projectToolbar";
import {
  pullMessage, pushMessage, syntheticStackSession,
  type PullResponse, type PushResponse, type StackRow,
} from "@/lib/stacks";
import type { SelfUpdate } from "@/lib/useSelfUpdate";
import type { SessionMeta } from "@/server/types";

/**
 * A project section's header: the name and its trailing rule, plus — when the project
 * is one projects.json maps — the management toolbar that used to be the Stacks tab
 * (RIC-253).
 *
 * The divider was the only thing on the board naming a project, and it did nothing; the
 * actions that belong to a project lived one tab away, on a screen that listed the same
 * names again. Merging them costs the board nothing (a header it already drew) and
 * removes a whole view.
 *
 * Icon-only buttons, each with `title` + `aria-label`: up to six actions have to fit
 * beside a project name on a 320px phone, which no set of labels does — and a divider
 * that pushed the first card off the fold would be a worse trade than a tooltip. The
 * exception is "Resolve with Claude", which appears only after a pull has already
 * failed and needs the words (see the message row below).
 *
 * `stack === null` is the ordinary case for the NO_PROJECT bucket and for a project
 * whose name only a session still carries: the header renders exactly as it always did.
 */
export default function ProjectToolbar({ project, stack, token, refresh, onOpenSession, selfUpdate }: {
  project: string;
  stack: StackRow | null;
  token: string;
  refresh: () => void;
  onOpenSession: (s: SessionMeta) => void;
  selfUpdate: SelfUpdate;
}) {
  return (
    <div className="proj-head">
      <h4 className="sect">
        {project}
        {/* Colour carries the state (green/grey/red); `title` says it in words. */}
        {stack?.hasStack && <span className={`s-dot ${stack.status ?? ""}`} title={stack.status ?? ""} />}
      </h4>
      <span className="sect-rule" aria-hidden="true" />
      {stack && (
        <StackActions
          stack={stack} token={token} refresh={refresh}
          onOpenSession={onOpenSession} selfUpdate={selfUpdate}
        />
      )}
    </div>
  );
}

/** What each action's button says — in its tooltip and to a screen reader. */
const LABELS: Record<ProjectAction, string> = {
  start: "Start stack",
  stop: "Stop stack",
  logs: "Stack logs",
  pull: "Pull",
  deploy: "Pull & deploy",
  push: "Push",
  "init-script": "Create worktree script",
};

const ICONS: Record<ProjectAction, typeof Play> = {
  start: Play,
  stop: Square,
  logs: ScrollText,
  pull: ArrowDownToLine,
  deploy: Rocket,
  push: ArrowUpToLine,
  "init-script": FileTerminal,
};

/** What a finished action has to say for itself, until the next one or a dismiss. */
type Note = { kind: "ok" | "err"; text: string; canResolve: boolean };

function StackActions({ stack, token, refresh, onOpenSession, selfUpdate }: {
  stack: StackRow;
  token: string;
  refresh: () => void;
  onOpenSession: (s: SessionMeta) => void;
  selfUpdate: SelfUpdate;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const post = async (path: string) => apiFetch(token, `/api/stacks/${stack.slug}/${path}`, { method: "POST" });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const act = (path: string) => run(async () => { await post(path); refresh(); });
  const pull = () => run(async () => {
    const res = await post("pull");
    setNote(pullMessage((await res.json()) as PullResponse));
    refresh();
  });
  const push = () => run(async () => {
    const res = await post("push");
    setNote({ ...pushMessage((await res.json()) as PushResponse), canResolve: false });
    refresh();
  });
  const resolve = () => run(async () => {
    const res = await post("resolve");
    if (res.ok) onOpenSession((await res.json()).meta as SessionMeta);
  });
  // Opens a plain Claude session in the project root, guided prompt already seeded, to
  // write scripts/init-worktree.sh together with the human — Mojito never guesses what a
  // repo's worktrees need before a ticket session can start working in one.
  const initScript = () => run(async () => {
    const res = await post("create-worktree-script");
    if (res.ok) onOpenSession((await res.json()).meta as SessionMeta);
  });

  const deploying = selfUpdate.phase === "pulling" || selfUpdate.phase === "deploying";
  const onAction: Record<ProjectAction, () => void> = {
    start: () => act("start"),
    stop: () => act("stop"),
    logs: () => onOpenSession(syntheticStackSession(stack.slug, stack.project)),
    pull,
    deploy: selfUpdate.run,
    push,
    "init-script": initScript,
  };

  const actions = projectActions(stack, selfUpdate.enabled);
  return (
    <>
      <div className="proj-actions">
        {actions.map((action) => {
          const Icon = ICONS[action];
          const label = action === "deploy" && deploying
            ? (selfUpdate.phase === "pulling" ? "Pulling…" : "Deploying…")
            : LABELS[action];
          return (
            <button
              key={action}
              className="btn sm ghost icon"
              disabled={busy || (action === "deploy" && deploying)}
              aria-label={label}
              title={label}
              onClick={onAction[action]}
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {/* The message row wraps to a line of its own — `.proj-head` is a wrapping flex
          row — so a long git message never squeezes the buttons that produced it. Its own
          two controls are wrapped together, so a failure long enough to push them onto a
          second line does not leave the ✕ stranded on a third. */}
      {note && (
        <div className={`proj-msg${note.kind === "err" ? " err" : ""}`}>
          <span className="txt">{note.text}</span>
          <span className="acts">
            {note.canResolve && (
              <button className="btn sm ghost" disabled={busy} onClick={resolve}>Resolve with Claude</button>
            )}
            <button className="x icon" aria-label="Dismiss" title="Dismiss" onClick={() => setNote(null)}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      {/* A deploy restarts the server under the page, so it reports where it was started
          from as well as in the Settings sheet that shares the same phase machine. */}
      {stack.self && selfUpdate.message && <div className="proj-msg">{selfUpdate.message}</div>}
      {stack.self && selfUpdate.phase === "deploying" && (
        <div className="proj-msg">Deploying — the server restarts in ~1 min…</div>
      )}
      {stack.self && selfUpdate.phase === "timeout" && (
        <div className="proj-msg err">Deploy still running — reload manually.</div>
      )}
      {stack.self && selfUpdate.error && <div className="proj-msg err">{selfUpdate.error}</div>}
    </>
  );
}
