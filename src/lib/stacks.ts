import type { SessionMeta } from "@/server/types";

export type StackStatus = "running" | "stopped" | "crashed";

export interface StackRow {
  project: string;
  slug: string;
  hasStack: boolean;
  status: StackStatus | null; // meaningful only when hasStack
  pullable: boolean; // false for the Mojito self-row
  self: boolean; // the Mojito checkout this server runs from
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

export type PushResponse =
  | { status: "pushed" | "up-to-date"; branch: string; from: string; to: string }
  | { error: string; detail?: string };

export function pushMessage(res: PushResponse): { kind: "ok" | "err"; text: string } {
  if ("status" in res) {
    if (res.status === "up-to-date") return { kind: "ok", text: `Nothing to push (${res.branch} at ${res.to}).` };
    return {
      kind: "ok",
      text: res.from ? `Pushed ${res.branch} ${res.from} → ${res.to}.` : `Pushed ${res.branch} (new remote branch).`,
    };
  }
  if (res.error === "detached") return { kind: "err", text: "Repo is on a detached HEAD — nothing to push." };
  const detail = res.detail ? ` — ${res.detail}` : "";
  // A rejected push is a non-fast-forward: the Pull button next to it is the fix, and it
  // already offers "Resolve with Claude" when the history has genuinely diverged.
  const base = res.error === "rejected" ? "origin has commits you don't have — Pull first" : "Push failed";
  return { kind: "err", text: `${base}${detail}` };
}

export function syntheticStackSession(slug: string, project: string): SessionMeta {
  return {
    kind: "custom",
    id: `stack-${slug}`,
    ticket: "",
    launchStatus: "",
    model: "",
    effort: "",
    state: "running",
    cwd: "",
    createdAt: "",
    projectName: project,
    title: `${project} · stack logs`,
    labels: [],
  };
}
