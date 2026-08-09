"use client";
import { useEffect, useState } from "react";
import { useStageDefaults } from "@/lib/useStageDefaults";
import type { SelfUpdate } from "@/lib/useSelfUpdate";
import { MODELS, EFFORTS, STAGE_DEFAULT_ROWS, resolveModel, resolveEffort, minimalOverrides, type StageDefaults } from "@/lib/stageDefaults";

export default function SettingsSheet({ token, onClose, selfUpdate }: {
  token: string; onClose: () => void; selfUpdate: SelfUpdate;
}) {
  const { defaults, loading, error, save } = useStageDefaults(token);
  // Local draft: one {model, effort} per launchable status, seeded from the fetched effective table.
  const [draft, setDraft] = useState<StageDefaults>({});
  const [saving, setSaving] = useState(false);

  // Self-update ("Pull & deploy"): only shown when the server exposes it
  // (MOJITO_SELF_UPDATE=1). `phase` drives the button label and banners. The hook
  // itself lives in page.tsx (one instance, shared with the Stacks self-row) so this
  // sheet can never disagree with that row about whether a deploy is in flight.
  const { enabled: selfUpdateEnabled, phase, message: pullMsg, error: pullErr, run: onPull } = selfUpdate;

  useEffect(() => {
    if (loading) return;
    const next: StageDefaults = {};
    for (const row of STAGE_DEFAULT_ROWS) {
      for (const s of row.statuses) {
        next[s] = { model: resolveModel(s, defaults), effort: resolveEffort(s, defaults) };
      }
    }
    setDraft(next);
  }, [loading, defaults]);

  // A row edits all its statuses together (Backlog/Todo share one control).
  const setRow = (statuses: string[], patch: Partial<{ model: string; effort: string }>) => {
    setDraft((d) => {
      const next = { ...d };
      for (const s of statuses) {
        next[s] = {
          model: patch.model ?? next[s].model,
          effort: (patch.effort as StageDefaults[string]["effort"]) ?? next[s].effort,
        };
      }
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    // Persist only the entries that differ from the built-in seed, so the stored file stays a
    // partial map and future BUILTIN_STAGE_DEFAULTS changes still reach untouched statuses.
    const ok = await save(minimalOverrides(draft));
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Stage defaults</h3>
        <p className="sheet-title">Default model &amp; effort per lifecycle stage, pre-filled when launching.</p>
        {loading ? <p className="empty">Loading…</p> : STAGE_DEFAULT_ROWS.map((row) => {
          const first = row.statuses[0];
          const cur = draft[first] ?? { model: "opus", effort: "high" };
          return (
            <div key={row.label}>
              <div className="two" style={{ alignItems: "flex-end" }}>
                <label className="field"><span className="lbl">{row.label}</span>
                  <select value={cur.model} onChange={(e) => setRow(row.statuses, { model: e.target.value })}>
                    {MODELS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="field"><span className="lbl">Effort</span>
                  <select value={cur.effort} onChange={(e) => setRow(row.statuses, { effort: e.target.value })}>
                    {EFFORTS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving || loading} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="err-text">{error}</p>}
        {selfUpdateEnabled && (
          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Server</h3>
            <p className="sheet-title">Pull the latest main into this server&apos;s checkout, then rebuild and restart the app — even when there is nothing new to pull.</p>
            <button
              className="btn block"
              disabled={phase === "pulling" || phase === "deploying"}
              onClick={onPull}
            >
              {phase === "pulling" ? "Pulling…" : phase === "deploying" ? "Deploying…" : "Pull & deploy"}
            </button>
            {pullMsg && <p className="sheet-title" style={{ margin: "10px 0 0" }}>{pullMsg}</p>}
            {phase === "deploying" && (
              <p className="sheet-title" style={{ margin: "8px 0 0" }}>Deploying — the server restarts in ~1 min…</p>
            )}
            {phase === "timeout" && <p className="err-text">Deploy still running — reload manually.</p>}
            {pullErr && <p className="err-text">{pullErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
