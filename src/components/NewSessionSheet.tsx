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
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "custom", projectName: project === GENERAL ? null : project, model, effort }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <div className="two">
          <label className="field"><span className="lbl">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field"><span className="lbl">Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <button className="btn primary block" onClick={start}>Start session</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
