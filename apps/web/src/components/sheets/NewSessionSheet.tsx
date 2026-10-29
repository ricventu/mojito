import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Effort, Model, SessionKind, SessionMeta, Settings } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useProjects } from "@/hooks/useProjects";
import { useSettings } from "@/hooks/useSettings";
import { ApiError, apiJson } from "@/lib/api";
import { FALLBACK, launchErrorAction } from "@/lib/launch";
import { qk } from "@/lib/queryKeys";
import { LaunchOptions } from "./LaunchOptions";
import { SHEET_CONTENT_CLASS } from "./styles";

/** A select item cannot have an empty value, so General (no project) travels under this one. */
const GENERAL = "__general__";

type FreeKind = Exclude<SessionKind, "ticket">;

function Form({ project: preselected, settings, onClose }: { project?: string; settings: Settings; onClose: () => void }) {
  const projects = useProjects();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const defaults = settings.statusDefaults["In Progress"] ?? FALLBACK;
  const [project, setProject] = useState(preselected ?? GENERAL);
  const [kind, setKind] = useState<FreeKind>("claude");
  const [model, setModel] = useState<Model>(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);

  const launch = useMutation({
    mutationFn: () =>
      apiJson<{ session: SessionMeta; warning?: string }>("/api/sessions", "POST", {
        kind,
        project: project === GENERAL ? null : project,
        ...(kind === "claude" ? { model, effort } : {}),
      }),
    onSuccess: ({ session, warning }) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      if (warning) toast.warning(warning);
      onClose();
      navigate(`/session/${encodeURIComponent(session.id)}`);
    },
    onError: (e) => {
      const action =
        e instanceof ApiError
          ? launchErrorAction(e)
          : { kind: "toast" as const, message: e instanceof Error ? e.message : "Launch failed" };
      if (action.kind === "open") {
        onClose();
        navigate(`/session/${encodeURIComponent(action.sessionId)}`);
      } else {
        toast.error(action.message);
      }
    },
  });

  return (
    <div className="flex flex-col gap-4 px-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-session-project">Project</Label>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger id="new-session-project" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.name}
              </SelectItem>
            ))}
            <SelectItem value={GENERAL}>General</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-session-kind">Type</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as FreeKind)}>
          <SelectTrigger id="new-session-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">claude</SelectItem>
            <SelectItem value="shell">shell</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {kind === "claude" && (
        <LaunchOptions idPrefix="new-session" model={model} effort={effort} onModel={setModel} onEffort={setEffort} />
      )}
      <Button disabled={launch.isPending} onClick={() => launch.mutate()}>
        <Play size={16} /> {launch.isPending ? "Launching…" : "Launch"}
      </Button>
    </div>
  );
}

interface Props {
  /** Preselected project; omitted = General. */
  project?: string;
  onClose: () => void;
}

/** A session that belongs to no ticket: claude or a plain shell, in a project's repo or in the home directory. */
export function NewSessionSheet({ project, onClose }: Props) {
  const settings = useSettings();
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <SheetTitle>New session</SheetTitle>
          <SheetDescription className="sr-only">Launch a free session, with no ticket</SheetDescription>
        </SheetHeader>
        {settings.data ? (
          <Form project={project} settings={settings.data} onClose={onClose} />
        ) : (
          <p className="px-4 text-sm text-muted-foreground">
            {settings.error instanceof Error ? settings.error.message : "Loading…"}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
