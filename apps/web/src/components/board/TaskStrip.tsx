import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import type { TaskRecord, TaskStatus } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { safeHref } from "@/lib/url";

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "text-muted-foreground" },
  running: { label: "Running", className: "text-sky-600 dark:text-sky-400" },
  done: { label: "Created", className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "text-destructive" },
};

function TaskCard({ task }: { task: TaskRecord }) {
  const qc = useQueryClient();
  const action = useMutation({
    mutationFn: (verb: "retry" | "archive") => apiJson<unknown>(`/api/tasks/${encodeURIComponent(task.id)}/${verb}`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tasks }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });
  const finished = task.status === "done" || task.status === "failed";
  const look = STATUS[task.status];

  return (
    <li className="rounded-lg border bg-card text-card-foreground">
      <Collapsible>
        <div className="flex items-start gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={look.className}>{look.label}</Badge>
              <span className="text-xs text-muted-foreground">{task.input.project}</span>
              {task.result && (
                <a
                  href={safeHref(task.result.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {task.result.identifier}
                </a>
              )}
            </div>
            <p className="line-clamp-2 text-sm break-words">{task.input.note}</p>
            {task.status === "failed" && task.error && (
              <p className="text-xs break-words text-destructive">{task.error}</p>
            )}
          </div>
          {task.status === "failed" && (
            <Button variant="outline" size="xs" disabled={action.isPending} onClick={() => action.mutate("retry")}>
              <RotateCcw size={12} /> Retry
            </Button>
          )}
          {finished && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Archive"
              disabled={action.isPending}
              onClick={() => action.mutate("archive")}
            >
              <X size={14} />
            </Button>
          )}
        </div>
        {task.log.length > 0 && (
          <>
            <CollapsibleTrigger className="group flex w-full items-center gap-1 border-t px-3 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <ChevronRight size={12} className="transition-transform group-data-[state=open]:rotate-90" />
              Log ({task.log.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className={cn("max-h-48 overflow-auto border-t px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words")}>
                {task.log.join("\n")}
              </pre>
            </CollapsibleContent>
          </>
        )}
      </Collapsible>
    </li>
  );
}

/** Background create-ticket tasks that have not been archived; renders nothing without any. */
export function TaskStrip({ tasks }: { tasks: TaskRecord[] }) {
  const visible = tasks.filter((t) => !t.archived);
  if (visible.length === 0) return null;
  return (
    <ul aria-label="Background tasks" className="flex flex-col gap-2">
      {visible.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
    </ul>
  );
}
