import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SquareTerminal, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { SessionMeta } from "@mojito/shared";
import { StateBadge } from "@/components/StateBadge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SessionMeta["kind"], string> = {
  ticket: "Ticket",
  claude: "Claude",
  shell: "Shell",
};

/** A session that belongs to no ticket; tapping it opens its terminal. */
export function FreeSessionRow({ session }: { session: SessionMeta }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => apiFetch<unknown>(`/api/sessions/${encodeURIComponent(session.id)}?remove=1`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rimozione non riuscita"),
  });
  const waiting = session.state === "needs-input";

  return (
    <li className={cn("flex items-stretch rounded-lg border bg-card", waiting && "border-amber-500/60")}>
      <button
        type="button"
        onClick={() => navigate(`/session/${encodeURIComponent(session.id)}`)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <SquareTerminal size={16} className="shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{KIND_LABEL[session.kind]}</span>
          {waiting && session.alert && (
            <span className="text-xs text-amber-700 dark:text-amber-300">{session.alert}</span>
          )}
        </span>
        <StateBadge state={session.state} />
      </button>
      {session.state === "ended" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto self-center text-muted-foreground"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 size={14} /> Rimuovi
        </Button>
      )}
    </li>
  );
}
