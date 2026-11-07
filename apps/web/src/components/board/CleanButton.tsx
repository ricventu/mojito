import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrushCleaning, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { CleanResult, WorktreeCount } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { apiFetch, apiJson } from "@/lib/api";
import { cleanLabel, cleanMessage, worktreeBadge } from "@/lib/clean";
import { qk, worktreeKey } from "@/lib/queryKeys";

/**
 * A project's Clean (RIC-528): opens the project's clean session, whose Claude lists merged
 * branches and worktrees and deletes them only once confirmed in the terminal. The badge counts
 * the linked worktrees, re-read every 30 s while the page is visible (worktrees come and go with
 * sessions, which emit nothing about them) and on every reconnect (it lives under `qk`).
 */
export function CleanButton({ project }: { project: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = `/api/projects/${encodeURIComponent(project)}`;
  const worktrees = useQuery({
    queryKey: worktreeKey(project),
    queryFn: () => apiFetch<WorktreeCount>(`${path}/worktrees`),
    refetchInterval: 30_000,
    // Not a repository, say: no badge, and no retrying a question git already answered.
    retry: false,
  });
  const clean = useMutation({
    mutationFn: () => apiJson<CleanResult>(`${path}/clean`, "POST"),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      toast.info(cleanMessage(result.alreadyOpen));
      navigate(`/session/${encodeURIComponent(result.session.id)}`);
    },
    onError: (e) => toast.error(`Clean failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const count = worktrees.data?.count;
  const badge = worktreeBadge(count);
  const label = cleanLabel(project, count);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={clean.isPending}
      onClick={() => clean.mutate()}
      className="relative"
    >
      {clean.isPending ? <Loader2 size={16} className="animate-spin" /> : <BrushCleaning size={16} />}
      {badge && (
        <span
          aria-hidden
          className="bg-primary text-primary-foreground pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums"
        >
          {badge}
        </span>
      )}
    </Button>
  );
}
