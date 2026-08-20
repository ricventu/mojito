import type { Registry } from "./registry";
import type { SessionMeta } from "./types";
import { readLaunchContext } from "./launchContext";
import { resolveTicketCwd } from "./ticketCwd";

export interface AdoptOrphansDeps {
  readContext?: (stateDir: string, id: string) => ReturnType<typeof readLaunchContext>;
  resolveCwd?: (projectsPath: string, ticket: string, projectName: string | null) => string | null;
  nowIso?: () => string;
}

// mojito-<TICKET>-<suffix> (work session, or the -conflict fix session) — teamKey is
// always uppercase, so this never matches mojito-custom-… or mojito-shell-….
const TICKET_SESSION_RE = /^mojito-([A-Z][A-Z0-9]*-\d+)-/;

/**
 * The other half of boot recovery that Registry.recover() doesn't cover: a tmux session
 * that is alive but has no registry entry at all — orphaned by a Mojito process that
 * died between spawning the session and writing its sidecar (the exact race a slow
 * synchronous launch step used to cause; see createTicketWorktree's own history). Without
 * this, such a session is invisible in the UI forever while `hasSession` still reports it
 * as taken, so a relaunch attempt reports "duplicate" for a session nobody can see or kill.
 *
 * Best-effort by construction: a ticket session's launch context (if its file is still on
 * disk) reconstructs the real ticket/title/labels/project; model and effort are never
 * recoverable from that, so they come back empty rather than guessed. Anything not
 * recognizable as a ticket session still gets a minimal, visible entry — the point is that
 * nothing live stays invisible, not that every field is exact.
 */
export function adoptOrphanSessions(
  registry: Registry,
  stateDir: string,
  projectsPath: string,
  liveSessionNames: string[],
  deps: AdoptOrphansDeps = {},
): void {
  const readContext = deps.readContext ?? readLaunchContext;
  const resolveCwd = deps.resolveCwd ?? resolveTicketCwd;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  for (const id of liveSessionNames) {
    if (registry.get(id)) continue; // known — Registry.recover() owns the dead-registration side

    const ticketMatch = TICKET_SESSION_RE.exec(id);
    const ctx = ticketMatch ? readContext(stateDir, id) : null;

    const meta: SessionMeta = ctx
      ? {
          kind: "ticket",
          id,
          ticket: ctx.identifier,
          launchStatus: ctx.statusName,
          model: "",
          effort: "",
          state: "running",
          cwd: resolveCwd(projectsPath, ctx.identifier, ctx.project) ?? "",
          createdAt: nowIso(),
          projectName: ctx.project,
          title: ctx.title,
          labels: ctx.labels,
        }
      : {
          kind: id.startsWith("mojito-shell-") ? "shell" : ticketMatch ? "ticket" : "custom",
          id,
          ticket: ticketMatch?.[1] ?? "",
          launchStatus: "",
          model: "",
          effort: "",
          state: "running",
          cwd: "",
          createdAt: nowIso(),
          title: id,
          labels: [],
        };
    registry.upsert(meta);
  }
}
