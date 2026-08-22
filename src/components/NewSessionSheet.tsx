"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { launchedSession } from "@/lib/launchedSession";
import { useProjectPicker } from "@/lib/useProjectPicker";
import { projectOptions } from "@/lib/projectOptions";
import { Combobox } from "./ui/combobox";
import { Choice } from "./ui/choice";
import { worktreeOptions, REPO_ROOT, type WorktreeChoice } from "@/lib/worktreeOptions";
import type { SessionMeta } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export default function NewSessionSheet(
  { token, defaultProject, onClose, onLaunched, onOpen }:
  {
    token: string;
    // The project the board is filtered on, when its multi-select names exactly one
    // (see soleProject) — a session started while looking at one project is for that
    // project (RIC-224). `null` is General (home), and also what several projects
    // resolve to, since one field cannot honour them all.
    defaultProject: string | null;
    onClose: () => void;
    onLaunched: () => void;
    onOpen: (s: SessionMeta) => void;
  },
) {
  const { projects, project, setProject, projectName } = useProjectPicker(token, defaultProject);
  const [mode, setMode] = useState<"claude" | "terminal">("claude");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [err, setErr] = useState<string | null>(null);
  // The worktrees of the selected project's repo, and which one to open in (RIC-243).
  // Re-fetched per project, and the selection resets with it: a path from the previous
  // project is not a worktree of this one, and the server would refuse it anyway.
  const [worktrees, setWorktrees] = useState<WorktreeChoice[]>([]);
  const [worktree, setWorktree] = useState(REPO_ROOT);
  useEffect(() => {
    let live = true;
    setWorktree(REPO_ROOT);
    // General has no repo, so there is nothing to ask the server about.
    if (!projectName) { setWorktrees([]); return; }
    (async () => {
      try {
        const res = await apiFetch(token, `/api/projects/worktrees?projectName=${encodeURIComponent(projectName)}`);
        const data = res.ok ? await res.json() : null;
        if (live) setWorktrees(Array.isArray(data?.worktrees) ? data.worktrees : []);
      } catch {
        // Unreachable check hides the field, which is what "no worktrees" already means:
        // the launch lands in the repo root exactly as it did before this existed.
        if (live) setWorktrees([]);
      }
    })();
    return () => { live = false; };
  }, [token, projectName]);

  const start = async () => {
    // Only a real pick travels; REPO_ROOT is the empty string the server reads as "no pick".
    const picked = worktree ? { worktree } : {};
    const body = mode === "terminal"
      ? { kind: "shell", projectName, ...picked }
      : { kind: "custom", projectName, model, effort, ...picked };
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    // Land in the session that was just started rather than back on the list — same rule as
    // LaunchSheet. An unreadable 201 body leaves nothing to open, so the sheet just closes.
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* fall through to onClose */ }
    const opened = launchedSession(payload);
    if (opened) onOpen(opened);
    else onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>
        <div className="btns" style={{ marginBottom: 12 }}>
          <button className={`btn ${mode === "claude" ? "primary" : "ghost"}`} onClick={() => setMode("claude")}>Claude</button>
          <button className={`btn ${mode === "terminal" ? "primary" : "ghost"}`} onClick={() => setMode("terminal")}>Terminal</button>
        </div>
        {/* A div, not a label: the field is a button now (see ui/combobox), and a
            <button> is not a labelable control — the trigger carries its own name. */}
        <div className="field"><span className="lbl">Project</span>
          <Combobox options={projectOptions(projects)} value={project} onChange={setProject}
            label="Project" searchLabel="Search projects…" emptyLabel="No project matches." />
        </div>
        {/* Hidden when there is nothing to choose: General, and any project whose repo has
            no linked worktree. A field with one option is noise. */}
        {worktrees.length > 0 && (
          <div className="field"><span className="lbl">Worktree</span>
            <Combobox options={worktreeOptions(worktrees)} value={worktree} onChange={setWorktree}
              label="Worktree" searchLabel="Search worktrees…" emptyLabel="No worktree matches." />
          </div>
        )}
        {mode === "claude" && (
          <div className="two">
            <div className="field"><span className="lbl">Model</span>
              <Choice label="Model" value={model} onChange={setModel} options={MODELS} /></div>
            <div className="field"><span className="lbl">Effort</span>
              <Choice label="Effort" value={effort} onChange={setEffort} options={EFFORTS} /></div>
          </div>
        )}
        <button className="btn primary block" onClick={start}>{mode === "terminal" ? "Start terminal" : "Start session"}</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
