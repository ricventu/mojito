import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, postComment } from "@/server/linear";
import { launchSession } from "@/server/launch";
import { hasSession, newSession, pipePane, closeSession } from "@/server/tmux";
import { tmuxName } from "@/server/sessionKey";
import { supersedeSession } from "@/server/supersede";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";

const VALID_ARGS = ["approve", "reject", "local", "mr"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const { arg, reason } = body;
  if (!VALID_ARGS.includes(arg)) return new NextResponse("invalid arg", { status: 400 });
  const prev = getRegistry().get(id);
  if (!prev) return new NextResponse("not found", { status: 404 });
  const status = await getIssueStatus(cfg.linearApiKey, prev.ticket);
  // To QA verdict is a pure Linear mutation — resolve it in-process instead of
  // launching a claude/lime session (RIC-110). The To Merge gate (local/mr) still
  // falls through to the launch path below.
  if (status === "To QA" && (arg === "approve" || arg === "reject")) {
    try {
      await resolveQaVerdict(
        { ticket: prev.ticket, arg, reason },
        {
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          postComment: (t, b) => postComment(cfg.linearApiKey, t, b),
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "verdict failed";
      return NextResponse.json({ error: message }, { status: e instanceof QaVerdictError ? 400 : 422 });
    }
    await supersedeSession(id, { closeSession, registry: getRegistry() });
    return NextResponse.json({ ok: true, arg }, { status: 200 });
  }
  // The gate session that triggered this advance shares the same (ticket, status)
  // pair as the id we're about to launch, which produces the SAME tmux name.
  // Gracefully close and deregister it first so launchSession doesn't see it as a
  // duplicate and silently drop the verdict.
  const registry = getRegistry();
  const newId = tmuxName(prev.ticket, status);
  if (await hasSession(newId)) {
    await closeSession(newId);
    registry.remove(newId); // also removes the sidecar
  }
  const res = await launchSession(
    { ticket: prev.ticket, status, model: prev.model, effort: prev.effort,
      autoAdvance: prev.autoAdvance, projectName: prev.projectName ?? null, trailingArg: arg,
      title: prev.title ?? "", labels: prev.labels ?? [] },
    { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.reason === "duplicate" ? 409 : 422 });
  // Retire the originating gate session when the new stage runs under a distinct id.
  if (res.meta.id !== id) await supersedeSession(id, { closeSession, registry });
  return NextResponse.json(res.meta, { status: 201 });
}
