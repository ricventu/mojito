import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, getIssueContent, downloadLinearAsset, type IssueContent } from "@/server/linear";
import { prepareTicketAssets, MAX_ASSET_BYTES } from "@/server/ticketAssets";
import { launchSession, launchMergeFixSession } from "@/server/launch";
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

  const content = async (): Promise<IssueContent> => {
    try { return await getIssueContent(cfg.linearApiKey, id); } catch { return { description: "", attachments: [] }; }
  };

  const result = await resolveTicketVerdict(
    { ticket: id, arg, reason },
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
          launchRework: async (rejectReason) => {
            const status = "In Progress";
            const sid = tmuxName(id, status);
            if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
            // A ticket that hit a merge conflict and is then rejected would otherwise keep a
            // live conflict session running in the very worktree the rework session takes over.
            const cid = conflictSessionName(id);
            if (registry.get(cid)) await supersedeSession(cid, { closeSession, registry });
            const c = await content();
            const prepared = await prepareTicketAssets({
              stateDir: cfg.stateDir, id: sid, description: c.description, attachments: c.attachments,
              download: (url) => downloadLinearAsset(cfg.linearApiKey, url, MAX_ASSET_BYTES),
            });
            const res = await launchSession(
              { ticket: id, status, model: defaultModelForStatus(status),
                effort: defaultEffortForStatus(status), projectName, title, labels: [],
                description: c.description, assets: prepared.assets, attachments: prepared.attachments,
                rejectReason },
              tmuxDeps,
            );
            if (!res.ok) throw new Error(`rework session not launched: ${res.reason}`);
            workSessionRelaunched = true;
          },
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
        if (workSessionRelaunched) return;
        const sid = tmuxName(t, "In Progress");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, result: result.result }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
