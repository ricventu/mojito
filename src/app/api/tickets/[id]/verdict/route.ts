import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, getIssueContent, type IssueContent } from "@/server/linear";
import { launchMergeFixSession } from "@/server/launch";
import { mergeTicketBranch } from "@/server/merge";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { hasNothingToMerge } from "@/server/ticketMergeState";
import { tmuxName, conflictSessionName, validateTicket } from "@/server/sessionKey";
import { defaultModelForStatus, defaultEffortForStatus } from "@/server/stageDefaults";
import { retireDeadSession } from "@/server/retireSession";
import { resolveTicketDirs } from "@/server/ticketDirs";
import { hasSession, newSession, pipePane } from "@/server/tmux";

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
    projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() };

  const resolveDirs = () => resolveTicketDirs(cfg.projectsPath, id, projectName);

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
          nothingToMerge: () => hasNothingToMerge(cfg.projectsPath, id, projectName),
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          launchMergeFix: async (detail, mode) => {
            const sid = conflictSessionName(id);
            // Clears a dead registration left by a previous fix session; a live one is left
            // running, and the duplicate below hands it back rather than replacing it.
            await retireDeadSession(sid, { hasSession, registry });
            const status = "In Progress";
            const res = await launchMergeFixSession(
              { ticket: id, projectName, title, description: (await content()).description,
                model: defaultModelForStatus(status), effort: defaultEffortForStatus(status),
                mergeMode: mode, blocker: detail },
              tmuxDeps,
            );
            // "duplicate" means the fix session for this ticket is still alive — the user is
            // already working in it. Hand that one back; replacing it would mean killing it.
            if (!res.ok && res.reason !== "duplicate") {
              throw new Error(`merge-fix session not launched: ${res.reason}`);
            }
            return sid;
          },
        }),
      retireStaleSession: async (t) => {
        await retireDeadSession(tmuxName(t, "In Progress"), { hasSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, result: result.result }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
