import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, SquareTerminal, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { Button } from "@/components/ui/button";
import { useResume } from "@/hooks/useResume";
import { apiFetch } from "@/lib/api";
import { startedLabel } from "@/lib/board";
import { canResume } from "@/lib/endReason";
import { qk } from "@/lib/queryKeys";
import { sessionName } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

/**
 * A session with no ticket card to live under — a free session, or a ticket session whose
 * ticket has left the board — tapping it opens its terminal. An ended one offers Resume (claude
 * started again on its conversation, then its terminal) and Remove. A live one has nothing to
 * press: there is no Kill, claude is quit in its terminal.
 */
export function LooseSessionRow({ session }: { session: SessionMeta }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = `/api/sessions/${encodeURIComponent(session.id)}`;
  const remove = useMutation({
    mutationFn: () => apiFetch<unknown>(path, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Remove failed"),
  });
  const resume = useResume(session.id, () => navigate(`/session/${encodeURIComponent(session.id)}`));
  const waiting = session.state === "needs-input";
  const ended = session.state === "ended";
  const label = session.kind === "ticket" && session.ticket ? session.ticket : sessionName(session);

  return (
    <li className={cn("flex items-stretch rounded-lg border bg-card", waiting && "border-amber-500/60")}>
      <button
        type="button"
        onClick={() => navigate(`/session/${encodeURIComponent(session.id)}`)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <SquareTerminal size={16} className="shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* A long name gives way, the time stays. */}
          <span className="flex min-w-0 text-sm font-medium">
            <span className={cn("truncate", session.kind === "ticket" && "font-mono")}>{label}</span>
            <span className="shrink-0 font-normal whitespace-pre text-muted-foreground"> · {startedLabel(session.createdAt)}</span>
          </span>
          {waiting && session.alert && (
            <span className="text-xs text-amber-700 dark:text-amber-300">{session.alert}</span>
          )}
        </span>
        <StateBadge state={session.state} endReason={session.endReason} />
      </button>
      {ended ? (
        <>
          {canResume(session) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto self-center text-muted-foreground"
              disabled={resume.isPending}
              aria-label="Resume"
              onClick={() => resume.mutate()}
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">Resume</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto self-center text-muted-foreground"
            disabled={remove.isPending}
            aria-label="Remove"
            onClick={() => remove.mutate()}
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">Remove</span>
          </Button>
        </>
      ) : null}
    </li>
  );
}
