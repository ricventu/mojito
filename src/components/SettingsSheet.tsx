"use client";
import { useEffect, useState } from "react";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { apiFetch } from "@/lib/client";
import { MODELS, EFFORTS, STAGE_DEFAULT_ROWS, resolveModel, resolveEffort, minimalOverrides, type StageDefaults } from "@/lib/stageDefaults";

export default function SettingsSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const { defaults, loading, error, save } = useStageDefaults(token);
  // Local draft: one {model, effort} per launchable status, seeded from the fetched effective table.
  const [draft, setDraft] = useState<StageDefaults>({});
  const [saving, setSaving] = useState(false);
  // Auto-scale toggle: whether review launches at stage defaults may scale down on small
  // branches. Fetched from its own endpoint; saved together with the stage defaults.
  const [autoScale, setAutoScale] = useState(true);
  useEffect(() => {
    if (!token) return;
    apiFetch(token, "/api/config/review-scale")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.autoScale === "boolean") setAutoScale(b.autoScale); })
      .catch(() => { /* keep the default-on assumption */ });
  }, [token]);

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
    const scaleRes = await apiFetch(token, "/api/config/review-scale", {
      method: "PUT",
      body: JSON.stringify({ autoScale }),
    }).catch(() => null);
    setSaving(false);
    if (ok && scaleRes?.ok) onClose();
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
              {row.hint && (
                <p style={{ margin: "4px 0 10px", font: "400 11px/1.4 var(--mono)", color: "var(--text-dim)", opacity: autoScale ? 1 : 0.45 }}>
                  ⤵ {row.hint}{!autoScale && " (off)"}
                </p>
              )}
            </div>
          );
        })}
        <label className="field" style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={autoScale} onChange={(e) => setAutoScale(e.target.checked)} />
          <span className="lbl" style={{ margin: 0 }}>Auto-scale review depth on small branches</span>
        </label>
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving || loading} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
  );
}
