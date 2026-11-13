import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { Command, WorktreeCount } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { useRunCommand } from "@/hooks/useRunCommand";
import { apiFetch } from "@/lib/api";
import { CommandIconView } from "@/lib/commandIcons";
import { cleanLabel, worktreeBadge } from "@/lib/commands";
import { worktreeKey } from "@/lib/queryKeys";

/**
 * A command with its own button on the project header (Clean, RIC-528): opens the command's
 * session. Clean's badge counts the linked worktrees, re-read every 30 s while the page is
 * visible (worktrees come and go with sessions, which emit nothing about them) and on every
 * reconnect (it lives under `qk`).
 */
export function CommandButton({ project, command }: { project: string; command: Command }) {
  const run = useRunCommand(project);
  const isClean = command.id === "clean";
  const worktrees = useQuery({
    queryKey: worktreeKey(project),
    queryFn: () => apiFetch<WorktreeCount>(`/api/projects/${encodeURIComponent(project)}/worktrees`),
    refetchInterval: 30_000,
    // Not a repository, say: no badge, and no retrying a question git already answered.
    retry: false,
    enabled: isClean,
  });

  const count = isClean ? worktrees.data?.count : undefined;
  const badge = worktreeBadge(count);
  const label = isClean ? cleanLabel(project, count) : `${command.name} ${project}`;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={run.isPending}
      onClick={() => run.mutate(command)}
      className="relative"
    >
      {run.isPending ? <Loader2 size={16} className="animate-spin" /> : <CommandIconView icon={command.icon} />}
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
