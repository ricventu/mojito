"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GENERAL = "__general__";

export default function NewSessionSheet(
  { token, onClose, onLaunched }:
  { token: string; onClose: () => void; onLaunched: () => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [mode, setMode] = useState<"claude" | "terminal">("claude");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

  const start = async () => {
    const projectName = project === GENERAL ? null : project;
    const body = mode === "terminal"
      ? { kind: "shell", projectName }
      : { kind: "custom", projectName, model, effort };
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>
        <div className="btns" style={{ marginBottom: 12 }}>
          <button className={`btn ${mode === "claude" ? "primary" : "ghost"}`} onClick={() => setMode("claude")}>Claude</button>
          <button className={`btn ${mode === "terminal" ? "primary" : "ghost"}`} onClick={() => setMode("terminal")}>Terminal</button>
        </div>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        {mode === "claude" && (
          <div className="two">
            <label className="field"><span className="lbl">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="field"><span className="lbl">Effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
        )}
        <button className="btn primary block" onClick={start}>{mode === "terminal" ? "Start terminal" : "Start session"}</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
