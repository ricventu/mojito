export type SelfUpdateResponse =
  | { status: "updated" | "up-to-date"; from: string; to: string }
  | { error: string; detail?: string };

// "Pull & deploy" always rebuilds and restarts, so an up-to-date pull still reports a
// redeploy rather than "nothing happened".
export function selfUpdateMessage(res: SelfUpdateResponse): { kind: "ok" | "err"; text: string } {
  if ("status" in res) {
    return res.status === "up-to-date"
      ? { kind: "ok", text: `Already up to date (${res.from}) — redeploying.` }
      : { kind: "ok", text: `Updated ${res.from} → ${res.to}.` };
  }
  const detail = res.detail ? ` — ${res.detail}` : "";
  return res.error === "diverged"
    ? { kind: "err", text: `History diverged — resolve from a terminal${detail}` }
    : { kind: "err", text: `Update failed${detail}` };
}
