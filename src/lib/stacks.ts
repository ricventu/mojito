import type { SessionMeta } from "@/server/types";

export type StackStatus = "running" | "stopped" | "crashed";

export interface StackRow {
  project: string;
  slug: string;
  hasStack: boolean;
  status: StackStatus | null; // meaningful only when hasStack
  pullable: boolean; // false for the Mojito self-row
}

export type PullResponse =
  | { status: "updated" | "up-to-date"; from: string; to: string }
  | { error: string; detail?: string };

export function pullMessage(res: PullResponse): { kind: "ok" | "err"; text: string; canResolve: boolean } {
  if ("status" in res) {
    return res.status === "updated"
      ? { kind: "ok", text: `Updated ${res.from} → ${res.to}.`, canResolve: false }
      : { kind: "ok", text: `Already up to date (${res.from}).`, canResolve: false };
  }
  const base = res.error === "diverged" ? "History diverged" : "Pull failed";
  const text = res.detail ? `${base} — ${res.detail}` : base;
  return { kind: "err", text, canResolve: true };
}

export function syntheticStackSession(slug: string, project: string): SessionMeta {
  return {
    kind: "custom",
    id: `stack-${slug}`,
    ticket: "",
    launchStatus: "",
    model: "",
    effort: "",
    autoAdvance: false,
    state: "running",
    cwd: "",
    createdAt: "",
    projectName: project,
    title: `${project} · stack logs`,
    labels: [],
  };
}
