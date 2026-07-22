"use client";
import { useEffect, useState } from "react";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { apiFetch } from "@/lib/client";
import { MODELS, EFFORTS, STAGE_DEFAULT_ROWS, resolveModel, resolveEffort, minimalOverrides, type StageDefaults } from "@/lib/stageDefaults";
import { initialPollState, nextPollState } from "@/lib/deployPoll";

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

  // Self-update ("Pull & deploy"): only shown when the server exposes it
  // (MOJITO_SELF_UPDATE=1). `phase` drives the button label and banners.
  const [selfUpdateEnabled, setSelfUpdateEnabled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "pulling" | "deploying" | "timeout">("idle");
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullErr, setPullErr] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    apiFetch(token, "/api/self-update")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.enabled === "boolean") setSelfUpdateEnabled(b.enabled); })
      .catch(() => { /* leave the section hidden */ });
  }, [token]);

  // Poll /api/health while a deploy is in flight, tied to the component lifecycle: if
  // Settings closes mid-deploy (SettingsSheet unmounts) or phase moves away from
  // "deploying", the cleanup cancels the pending tick so no further poll, setPhase, or
  // reload runs after that point — the user then reloads manually (see phase === "timeout").
  useEffect(() => {
    if (phase !== "deploying") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let state = initialPollState;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 5 * 60_000) { setPhase("timeout"); return; }
      let up = false;
      try { up = (await apiFetch(token, "/api/health")).ok; } catch { up = false; }
      if (cancelled) return;
      state = nextPollState(state, up);
      if (state.recovered) { location.reload(); return; }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, token]);

  const onPull = async () => {
    setPullErr(null);
    setPullMsg(null);
    setPhase("pulling");
    let res: Response;
    try {
      res = await apiFetch(token, "/api/self-update", { method: "POST" });
    } catch {
      setPhase("idle");
      setPullErr("Network error — could not reach the server.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 200 && body.status === "up-to-date") {
      setPhase("idle");
      setPullMsg(`Already up to date (${body.from}).`);
      return;
    }
    if (res.status === 200 && body.status === "updated") {
      setPullMsg(`Updated ${body.from} → ${body.to}.`);
      setPhase("deploying");
      return;
    }
    setPhase("idle");
    const detail = typeof body.detail === "string" && body.detail ? ` — ${body.detail}` : "";
    setPullErr(body.error === "diverged"
      ? `History diverged — resolve from a terminal${detail}`
      : `Update failed${detail}`);
  };

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
        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={autoScale} onChange={(e) => setAutoScale(e.target.checked)} />
          <span>Auto-scale review depth on small branches</span>
        </label>
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving || loading} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="err-text">{error}</p>}
        {selfUpdateEnabled && (
          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Server</h3>
            <p className="sheet-title">Pull the latest main into this server&apos;s checkout. The deploy hook then restarts the app.</p>
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
