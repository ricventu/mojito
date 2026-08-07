import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, getIssueDescription } from "@/server/linear";
import { launchSession, launchConflictSession } from "@/server/launch";
import { loadProjectMap, resolvePathForProject } from "@/server/limeProjects";
import { mergeTicketBranch, repoRootFromWorktree } from "@/server/merge";
import { resolveQaVerdict } from "@/server/qaVerdict";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { tmuxName, conflictSessionName, validateTicket } from "@/server/sessionKey";
import { defaultModelForStatus, defaultEffortForStatus } from "@/server/stageDefaults";
import { supersedeSession } from "@/server/supersede";
import { resolveTicketWorktree } from "@/server/ticketCwd";
import { closeSession, hasSession, newSession, pipePane } from "@/server/tmux";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const arg: string = typeof body.arg === "string" ? body.arg : "";
  const reason: string | undefined = typeof body.reason === "string" ? body.reason : undefined;
  const projectName: string | null = typeof body.projectName === "string" ? body.projectName : null;
  const title: string = typeof body.title === "string" ? body.title : "";

  const registry = getRegistry();
  const tmuxDeps = { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
    projectsPath: cfg.projectsPath, hasSession, newSession, pipePane };

  // The merge needs both sides of the ticket: the worktree holding the branch, and the
  // project's main checkout that receives a local fast-forward. A ticket without its own
  // worktree has no branch to merge. The main checkout comes from the project map when the
  // project is mapped, and otherwise from git itself (repoRootFromWorktree) — asking the
  // worktree beats guessing, and resolveTicketCwd would just hand back the worktree again.
  // Resolved lazily — a reject never merges, so it must not pay for the git lookups.
  const resolveDirs = async () => {
    const worktree = resolveTicketWorktree(cfg.projectsPath, id, projectName);
    const mapped = projectName ? resolvePathForProject(loadProjectMap(cfg.projectsPath), projectName) : null;
    return { worktree, repoRoot: mapped ?? (worktree ? await repoRootFromWorktree(worktree) : null) };
  };

  // A reject relaunches the ticket's work session under the same id, so the
  // stale-session cleanup below must not retire the session this request just started.
  let workSessionRelaunched = false;

  const describe = async () => {
    try { return await getIssueDescription(cfg.linearApiKey, id); } catch { return ""; }
  };

  const result = await resolveTicketVerdict(
    { ticket: id, arg, reason },
    {
      getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t),
      resolveVerdict: (i) =>
        resolveQaVerdict(i, {
          merge: async (mode) => {
            const { worktree, repoRoot } = await resolveDirs();
            if (!worktree) return { status: "error", detail: "no worktree for ticket" } as const;
            if (!repoRoot || worktree === repoRoot) {
              return { status: "error", detail: "cannot resolve the main checkout for the ticket worktree" } as const;
            }
            return mergeTicketBranch({ worktree, repoRoot, mode });
          },
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          launchRework: async (rejectReason) => {
            const status = "In Progress";
            const sid = tmuxName(id, status);
            if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
            // A ticket that hit a rebase conflict and is then rejected would otherwise keep a
            // live conflict session running in the very worktree the rework session takes over.
            const cid = conflictSessionName(id);
            if (registry.get(cid)) await supersedeSession(cid, { closeSession, registry });
            const res = await launchSession(
              { ticket: id, status, model: defaultModelForStatus(status),
                effort: defaultEffortForStatus(status), projectName, title, labels: [],
                description: await describe(), rejectReason },
              tmuxDeps,
            );
            if (!res.ok) throw new Error(`rework session not launched: ${res.reason}`);
            workSessionRelaunched = true;
          },
          launchConflictFix: async () => {
            const sid = conflictSessionName(id);
            if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
            const status = "In Progress";
            const res = await launchConflictSession(
              { ticket: id, projectName, title, description: await describe(),
                model: defaultModelForStatus(status), effort: defaultEffortForStatus(status) },
              tmuxDeps,
            );
            if (!res.ok) throw new Error(`conflict session not launched: ${res.reason}`);
          },
        }),
      supersedeStaleSession: async (t) => {
        if (workSessionRelaunched) return;
        const sid = tmuxName(t, "In Progress");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, result: result.result }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
