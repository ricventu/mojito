"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { SessionMeta } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GENERAL = "__general__";

export default function NewTicketSheet(
  { token, onClose, onCreated }:
  { token: string; onClose: () => void; onCreated: (meta: SessionMeta) => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [err, setErr] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

  const create = async () => {
    if (isSubmitting) return;
    setErr(null);
    setIsSubmitting(true);
    try {
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          kind: "new-ticket", brief: brief.trim(),
          projectName: project === GENERAL ? null : project, model, effort,
        }),
      });
      if (!res.ok) { setErr(await res.text()); return; }
      const meta: SessionMeta = await res.json();
      onCreated(meta);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New ticket</h3>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <label className="field"><span className="lbl">Description</span>
          <textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe the ticket — Claude will turn it into a title + description." />
        </label>
        <div className="two">
          <label className="field"><span className="lbl">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field"><span className="lbl">Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <button className="btn primary block" disabled={!brief.trim() || isSubmitting} onClick={create}>Create ticket</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
