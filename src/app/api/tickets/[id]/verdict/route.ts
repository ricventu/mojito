import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, getIssueContent, type IssueContent } from "@/server/linear";
import { launchMergeFixSession } from "@/server/launch";
import { loadProjectMap, resolvePathForProject } from "@/server/projects";
import { mergeTicketBranch, repoRootFromWorktree } from "@/server/merge";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";
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
  const resolveDirs = async () => {
    const worktree = resolveTicketWorktree(cfg.projectsPath, id, projectName);
    const mapped = projectName ? resolvePathForProject(loadProjectMap(cfg.projectsPath), projectName) : null;
    return { worktree, repoRoot: mapped ?? (worktree ? await repoRootFromWorktree(worktree) : null) };
  };

  const content = async (): Promise<IssueContent> => {
    try { return await getIssueContent(cfg.linearApiKey, id); } catch { return { description: "", attachments: [] }; }
  };

  const result = await resolveTicketVerdict(
    { ticket: id, arg },
    {
      getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t),
      resolveVerdict: (i) =>
        resolveQaVerdict(i, {
          merge: async (mode) => {
            // Precondition failures throw (HTTP 400): with no worktree there is nothing a
            // merge-fix session could even open. Everything mergeTicketBranch returns as
            // conflict/error is repairable in the worktree, so qaVerdict launches the fix.
            const { worktree, repoRoot } = await resolveDirs();
            if (!worktree) throw new QaVerdictError("no worktree for ticket");
            if (!repoRoot || worktree === repoRoot) {
              throw new QaVerdictError("cannot resolve the main checkout for the ticket worktree");
            }
            return mergeTicketBranch({ worktree, repoRoot, mode });
          },
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          launchMergeFix: async (detail, mode) => {
            const sid = conflictSessionName(id);
            if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
            const status = "In Progress";
            const res = await launchMergeFixSession(
              { ticket: id, projectName, title, description: (await content()).description,
                model: defaultModelForStatus(status), effort: defaultEffortForStatus(status),
                mergeMode: mode, blocker: detail },
              tmuxDeps,
            );
            if (!res.ok) throw new Error(`merge-fix session not launched: ${res.reason}`);
            return sid;
          },
        }),
      supersedeStaleSession: async (t) => {
        const sid = tmuxName(t, "In Progress");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, result: result.result }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
