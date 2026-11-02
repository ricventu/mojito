import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Effort, Model, PeerSnapshot, SessionKind, SessionMeta, Settings } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePeers } from "@/hooks/usePeers";
import { useProjects } from "@/hooks/useProjects";
import { useSettings } from "@/hooks/useSettings";
import { ApiError, apiJson } from "@/lib/api";
import { sessionHref } from "@/lib/host";
import { FALLBACK, launchErrorAction } from "@/lib/launch";
import { freeLaunchHosts, freeLaunchProjects } from "@/lib/peers";
import { qk } from "@/lib/queryKeys";
import { LaunchOptions } from "./LaunchOptions";
import { SHEET_CONTENT_CLASS } from "./styles";

/** A select item cannot have an empty value, so General (no project) travels under this one. */
const GENERAL = "__general__";

type FreeKind = Exclude<SessionKind, "ticket">;

function Form({ project: preselected, settings, onClose }: { project?: string; settings: Settings; onClose: () => void }) {
  const projects = useProjects();
  const peers = usePeers();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const defaults = settings.statusDefaults["In Progress"] ?? FALLBACK;
  const [projectPick, setProject] = useState(preselected ?? GENERAL);
  const [hostName, setHostName] = useState<string | null>(null);
  const [kind, setKind] = useState<FreeKind>("claude");
  const [model, setModel] = useState<Model>(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);

  const selfProjects = (projects.data ?? []).map((p) => p.name);
  const peerList = peers.data?.peers ?? [];
  const choices = freeLaunchProjects(selfProjects, peerList);
  // A project only an offline peer mapped is gone from the list: General takes its place.
  const project = projectPick === GENERAL || choices.includes(projectPick) ? projectPick : GENERAL;
  const hosts = freeLaunchHosts(project === GENERAL ? null : project, peers.data?.self ?? "", selfProjects, peerList);
  // A host that went offline (or does not map the project just picked) falls back to the first.
  const host = hosts.find((h) => h.name === hostName) ?? hosts[0];

  const launch = useMutation({
    mutationFn: ({ peer }: { peer: PeerSnapshot | null }) =>
      apiJson<{ session: SessionMeta; warning?: string }>(
        peer ? `/api/peers/${encodeURIComponent(peer.name)}/sessions` : "/api/sessions",
        "POST",
        {
          kind,
          project: project === GENERAL ? null : project,
          ...(kind === "claude" ? { model, effort } : {}),
        },
      ),
    onSuccess: ({ session, warning }, { peer }) => {
      if (warning) toast.warning(warning);
      onClose();
      if (peer) toast.success(`Started on ${peer.name}`);
      else void qc.invalidateQueries({ queryKey: qk.sessions });
      navigate(sessionHref(peer?.name ?? null, session.id));
    },
    onError: (e, { peer }) => {
      const action =
        e instanceof ApiError
          ? launchErrorAction(e)
          : { kind: "toast" as const, message: e instanceof Error ? e.message : "Launch failed" };
      if (action.kind === "open") {
        onClose();
        navigate(sessionHref(peer?.name ?? null, action.sessionId));
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
            {choices.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
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
      {/* Shown when there is a choice, or when the one host is a peer: where it runs is never a surprise. */}
      {host && (hosts.length > 1 || host.peer) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-session-host">Run on</Label>
          <Select value={host.name} onValueChange={setHostName}>
            <SelectTrigger id="new-session-host" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hosts.map((h) => (
                <SelectItem key={h.name} value={h.name}>
                  {h.peer ? h.name : `${h.name} (this one)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {kind === "claude" && (
        <LaunchOptions idPrefix="new-session" model={model} effort={effort} onModel={setModel} onEffort={setEffort} />
      )}
      <Button
        disabled={launch.isPending || !host || projects.isPending || peers.isPending}
        onClick={() => host && launch.mutate({ peer: host.peer })}
      >
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
