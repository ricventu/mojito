"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { launchedSession } from "@/lib/launchedSession";
import { useProjectPicker } from "@/lib/useProjectPicker";
import { projectOptions } from "@/lib/projectOptions";
import { Combobox } from "./ui/combobox";
import { Choice } from "./ui/choice";
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

  const start = async () => {
    const body = mode === "terminal"
      ? { kind: "shell", projectName }
      : { kind: "custom", projectName, model, effort };
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
