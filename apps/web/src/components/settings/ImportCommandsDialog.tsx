import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { importCommands, type Command } from "@mojito/shared";
import { toast } from "sonner";
import { SHEET_CONTENT_CLASS } from "@/components/sheets/styles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useProjects } from "@/hooks/useProjects";
import { apiFetch } from "@/lib/api";
import { importableRows, importErrorMessage } from "@/lib/commandForm";
import { CommandIconView } from "@/lib/commandIcons";
import { hostApi } from "@/lib/host";
import type { CommandsWrite } from "./CommandDialog";

interface Props {
  peer: string;
  write: CommandsWrite;
  onClose: () => void;
}

function Body({ peer, write, onClose }: Props) {
  const projects = useProjects();
  // Read afresh on each opening: the peer's list is a snapshot, never refetched under the reader.
  const query = useQuery({
    queryKey: ["peer-commands", peer],
    queryFn: () => apiFetch<{ commands: Command[] }>(hostApi(peer, "/api/commands")),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  // Ids the human unticked: enabled rows are checked by default.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const rows = query.data && projects.data ? importableRows(query.data.commands, projects.data.map((p) => p.name)) : [];
  const picked = rows.filter((r) => r.disabledReason === null && !unticked.has(r.command.id)).map((r) => r.command);

  const run = useMutation({
    mutationFn: () => write((s) => importCommands(s, picked)),
    onSuccess: () => {
      toast.success(`Imported ${picked.length} command${picked.length === 1 ? "" : "s"} from ${peer}`);
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Importing the commands failed."),
  });

  function toggle(id: string, on: boolean) {
    setUnticked((u) => {
      const next = new Set(u);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const loading = query.isPending || (query.isSuccess && projects.isPending);

  return (
    <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {importErrorMessage(peer, query.error)}
        </p>
      ) : projects.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {projects.error.message}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{peer} has no commands to import.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map(({ command, disabledReason }) => {
            const id = `import-${command.id}`;
            return (
              <li key={command.id} className="flex items-start gap-3 py-2">
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  disabled={disabledReason !== null}
                  checked={disabledReason === null && !unticked.has(command.id)}
                  onCheckedChange={(v) => toggle(command.id, v === true)}
                />
                <label htmlFor={id} className={`flex min-w-0 flex-1 flex-col gap-0.5 ${disabledReason ? "opacity-60" : ""}`}>
                  <span className="flex items-center gap-2">
                    <CommandIconView icon={command.icon} size={16} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{command.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{command.project ?? "All projects"}</span>
                  {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <SheetFooter className="flex-row justify-end gap-2 p-0">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={picked.length === 0 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Importing…" : `Import ${picked.length}`}
        </Button>
      </SheetFooter>
    </div>
  );
}

/** Pick commands from a peer's list and merge them into this instance's; mounted per opening. */
export function ImportCommandsDialog(props: Props) {
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <SheetTitle>Import from {props.peer}</SheetTitle>
          <SheetDescription>Same name replaces yours; the rest are added.</SheetDescription>
        </SheetHeader>
        <Body {...props} />
      </SheetContent>
    </Sheet>
  );
}
