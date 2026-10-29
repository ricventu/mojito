import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectRow } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useProjects } from "@/hooks/useProjects";
import { apiJson } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { ProjectDialog } from "./ProjectDialog";

/** The mapped projects: name, repo path and Linear team key, with add, edit and delete. */
export function ProjectsCard() {
  const projects = useProjects();
  const qc = useQueryClient();
  // `undefined` = closed, `null` = adding, a row = editing it.
  const [editing, setEditing] = useState<ProjectRow | null | undefined>(undefined);

  const remove = useMutation({
    mutationFn: (name: string) => apiJson<unknown>(`/api/projects/${encodeURIComponent(name)}`, "DELETE"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.tickets });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>The repos Mojito launches sessions in.</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={14} /> Add
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {projects.isError ? (
          <p className="text-sm text-destructive">{projects.error.message}</p>
        ) : !projects.data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects configured.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {projects.data.map((p) => (
              <li key={p.name} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.teamKey}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground" title={p.path}>
                    {p.path}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${p.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete the project ${p.name}?`)) remove.mutate(p.name);
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ProjectDialog project={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} />
    </Card>
  );
}
