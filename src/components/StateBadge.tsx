import type { SessionState } from "@/server/types";

const BADGE: Record<SessionState, { cls: string; label: string }> = {
  starting: { cls: "wait", label: "starting" },
  running: { cls: "run", label: "running" },
  idle: { cls: "idle", label: "idle" },
  "needs-input": { cls: "attn", label: "needs input" },
  done: { cls: "ok", label: "done" },
  failed: { cls: "err", label: "failed" },
};

export default function StateBadge({ state }: { state: SessionState }) {
  const b = BADGE[state];
  return (
    <span className={`badge ${b.cls}`}>
      <span className="dot" />
      <span className="lbl">{b.label}</span>
    </span>
  );
}
