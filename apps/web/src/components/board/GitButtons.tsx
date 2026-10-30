import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { GitOp, GitSyncResult } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/lib/api";
import { gitSyncAction } from "@/lib/gitSync";
import { gitKeys, qk } from "@/lib/queryKeys";

const OPS = [
  { op: "pull", label: "Pull", Icon: ArrowDownToLine },
  { op: "push", label: "Push", Icon: ArrowUpFromLine },
] as const;

/**
 * A project's Pull and Push. A conflict comes back as the project's git session, already
 * started by the server, whose terminal opens. One operation at a time per project (the server
 * refuses a second), so both buttons wait on whichever runs.
 */
export function GitButtons({ project }: { project: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: (op: GitOp) => apiJson<GitSyncResult>(`/api/projects/${encodeURIComponent(project)}/${op}`, "POST"),
    onSuccess: (result, op) => {
      // Every outcome moved (or may have moved) the repo, a conflict included: the graph is a
      // snapshot, so this is what keeps an open one honest.
      void qc.invalidateQueries({ queryKey: gitKeys.graphs(project) });
      const action = gitSyncAction(op, result);
      if (action.kind === "toast") {
        toast.success(action.message);
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.sessions });
      toast.info(action.message);
      navigate(`/session/${encodeURIComponent(action.sessionId)}`);
    },
    onError: (e, op) => toast.error(`${op === "pull" ? "Pull" : "Push"} failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  return OPS.map(({ op, label, Icon }) => (
    <Button
      key={op}
      variant="ghost"
      size="icon-sm"
      aria-label={`${label} ${project}`}
      title={label}
      disabled={sync.isPending}
      onClick={() => sync.mutate(op)}
    >
      {sync.isPending && sync.variables === op ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
    </Button>
  ));
}
