"use client";
import { useEffect, useState } from "react";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { MODELS, EFFORTS, STAGE_DEFAULT_ROWS, resolveModel, resolveEffort, minimalOverrides, type StageDefaults } from "@/lib/stageDefaults";

export default function SettingsSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const { defaults, loading, error, save } = useStageDefaults(token);
  // Local draft: one {model, effort} per launchable status, seeded from the fetched effective table.
  const [draft, setDraft] = useState<StageDefaults>({});
  const [saving, setSaving] = useState(false);

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
        <p className="sheet-title">Default model &amp; effort per lifecycle stage. Used on auto-advance and pre-filled when launching.</p>
        {loading ? <p className="empty">Loading…</p> : STAGE_DEFAULT_ROWS.map((row) => {
          const first = row.statuses[0];
          const cur = draft[first] ?? { model: "opus", effort: "high" };
          return (
            <div className="two" key={row.label} style={{ alignItems: "flex-end" }}>
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
          );
        })}
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving || loading} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
  );
}
