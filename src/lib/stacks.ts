import type { SessionMeta } from "@/server/types";

export type StackStatus = "running" | "stopped" | "crashed";

export interface StackRow {
  project: string;
  slug: string;
  hasStack: boolean;
  status: StackStatus | null; // meaningful only when hasStack
  pullable: boolean; // false for the Mojito self-row
}

export interface PullResponse {
  status?: "updated" | "up-to-date";
  from?: string;
  to?: string;
  error?: string;
  detail?: string;
}

export function pullMessage(response: PullResponse): string {
  if (response.error) {
    if (response.detail) {
      return `${response.error}: ${response.detail}`;
    }
    return response.error;
  }
  if (response.status === "updated") {
    return `updated: ${response.from} → ${response.to}`;
  }
  if (response.status === "up-to-date") {
    return `up-to-date at ${response.from}`;
  }
  return "unknown response";
}

export function syntheticStackSession(project: string): SessionMeta {
  const now = new Date();
  const uniqueSuffix = Math.random().toString(36).substring(2, 8);
  return {
    kind: "shell",
    id: `stack-${uniqueSuffix}`,
    ticket: "",
    launchStatus: "",
    model: "fable",
    effort: "",
    autoAdvance: false,
    state: "running",
    cwd: process.cwd(),
    createdAt: now.toISOString(),
    title: "",
    labels: [],
    projectName: project,
  };
}
