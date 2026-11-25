import { useState } from "react";
import { Play } from "lucide-react";
import type { Command, Effort, Model } from "@mojito/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { usePeers } from "@/hooks/usePeers";
import { useProjects } from "@/hooks/useProjects";
import { useRunCommand } from "@/hooks/useRunCommand";
import { CommandIconView } from "@/lib/commandIcons";
import { freeLaunchHosts } from "@/lib/peers";
import { LaunchOptions } from "./LaunchOptions";
import { SHEET_CONTENT_CLASS } from "./styles";

interface Props {
  project: string;
  command: Command;
  onClose: () => void;
}

/**
 * A quick command before it runs (RIC-622): where (Run on, with peers: every host listed, one
 * that cannot run the project says why), model, effort and worktree — each starting from the
 * command, for this run only. Run sends the command itself, so a peer runs exactly what is shown.
 */
export function RunCommandSheet({ project, command, onClose }: Props) {
  const projects = useProjects();
  const peers = usePeers();
  const run = useRunCommand(project, onClose);
  const [hostName, setHostName] = useState<string | null>(null);
  const [model, setModel] = useState<Model>(command.model);
  const [effort, setEffort] = useState<Effort>(command.effort);
  const [worktree, setWorktree] = useState(command.worktree);

  const selfProjects = (projects.data ?? []).map((p) => p.name);
  const hosts = freeLaunchHosts(project, peers.data?.self ?? "", selfProjects, peers.data?.peers ?? []);
  const runnable = hosts.filter((h) => h.unavailable === null);
  // A host that went offline (or stopped mapping the project) since it was picked falls back to the first that can.
  const host = runnable.find((h) => h.name === hostName) ?? runnable[0];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2">
            <CommandIconView icon={command.icon} />
            {command.name}
            <span className="text-muted-foreground font-normal">· {project}</span>
          </SheetTitle>
          <SheetDescription className="line-clamp-3 whitespace-pre-line">{command.prompt}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          {hosts.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="run-command-host">Run on</Label>
              <Select value={host?.name ?? ""} onValueChange={setHostName}>
                <SelectTrigger id="run-command-host" className="w-full">
                  <SelectValue placeholder="No host can run it" />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h.name} value={h.name} disabled={h.unavailable !== null}>
                      {h.peer ? h.name : `${h.name} (this one)`}
                      {h.unavailable && <span className="text-muted-foreground"> · {h.unavailable}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <LaunchOptions idPrefix="run-command" model={model} effort={effort} onModel={setModel} onEffort={setEffort} />
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="run-command-worktree">Work in a worktree</Label>
            <Switch id="run-command-worktree" checked={worktree} onCheckedChange={setWorktree} />
          </div>
          <Button
            disabled={run.isPending || !host || projects.isPending || peers.isPending}
            onClick={() => host && run.mutate({ command, host: host.peer?.name ?? null, options: { model, effort, worktree } })}
          >
            <Play size={16} /> {run.isPending ? "Starting…" : "Run"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
