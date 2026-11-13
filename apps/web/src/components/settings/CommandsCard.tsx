import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_COMMANDS, effectiveCommands, type Command, type CommandsSetting, type Settings } from "@mojito/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePeers } from "@/hooks/usePeers";
import { useSettings } from "@/hooks/useSettings";
import { apiJson } from "@/lib/api";
import { commandGroups, commandTag, restoreBlocked, restoreDefault } from "@/lib/commandForm";
import { CommandIconView } from "@/lib/commandIcons";
import { qk } from "@/lib/queryKeys";
import { CommandDialog, type CommandsWrite } from "./CommandDialog";
import { ImportCommandsDialog } from "./ImportCommandsDialog";

const WRITE_KEY = ["commands"] as const;

/**
 * The commands writes, one at a time in one scope. Each reads the stored commands from the cache
 * when it runs — after the previous write's answer is in it — so two quick edits both land.
 * Settings are re-read once the queue drains.
 */
function useCommandsWrite(): CommandsWrite {
  const qc = useQueryClient();
  const write = useMutation({
    mutationKey: WRITE_KEY,
    scope: { id: "commands" },
    mutationFn: async (update: (s: CommandsSetting) => CommandsSetting) => {
      const current = qc.getQueryData<Settings>(qk.settings)?.commands;
      if (!current) throw new Error("Settings have not loaded yet.");
      const settings = await apiJson<Settings>("/api/settings", "PUT", { commands: update(current) });
      qc.setQueryData(qk.settings, settings);
      return settings;
    },
    // This write is still counted: 1 means it is the last one queued.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: WRITE_KEY }) === 1) void qc.invalidateQueries({ queryKey: qk.settings });
    },
  });
  return write.mutateAsync;
}

function shippedName(id: string): string {
  return DEFAULT_COMMANDS.find((d) => d.id === id)?.name ?? id;
}

/** Settings → Commands: the quick commands in force, grouped by project, with add, edit and restore. */
export function CommandsCard() {
  const settings = useSettings();
  const write = useCommandsWrite();
  // `undefined` = closed, `null` = adding, a command = editing it.
  const [editing, setEditing] = useState<Command | null | undefined>(undefined);
  const stored = settings.data?.commands;
  const onlinePeers = (usePeers().data?.peers ?? []).filter((p) => p.online);
  // The peer whose import list is open.
  const [importing, setImporting] = useState<string | null>(null);

  function restore(id: string) {
    write((s) => restoreDefault(s, id)).then(
      () => toast.success(`Restored ${shippedName(id)}`),
      (e: unknown) => toast.error(e instanceof Error ? e.message : "Restoring the command failed."),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commands</CardTitle>
        <CardDescription>Saved prompts, run from a project's header. Each opens one session per project.</CardDescription>
        {stored && (
          <CardAction>
            <Button size="sm" onClick={() => setEditing(null)}>
              <Plus size={14} /> Add command
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings.isError ? (
          <p className="text-sm text-destructive">{settings.error.message}</p>
        ) : !stored ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {commandGroups(effectiveCommands(stored)).map((group) => (
              <section key={group.project ?? ""} className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">{group.project ?? "All projects"}</h3>
                <ul className="flex flex-col divide-y">
                  {group.commands.map((c) => {
                    const tag = commandTag(stored, c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setEditing(c)}
                          className="flex w-full items-center gap-2 rounded-md py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <CommandIconView icon={c.icon} size={16} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                          {tag && <Badge variant={tag === "Edited" ? "outline" : "secondary"}>{tag}</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {effectiveCommands(stored).length === 0 && (
              <p className="text-sm text-muted-foreground">No commands. Add one, or restore a default.</p>
            )}
            {onlinePeers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {onlinePeers.map((p) => (
                  <Button key={p.name} variant="outline" size="sm" onClick={() => setImporting(p.name)}>
                    <Download size={14} /> Import from {p.name}
                  </Button>
                ))}
              </div>
            )}
            {stored.removed.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                Removed defaults:
                {stored.removed.map((id) => {
                  const blocked = restoreBlocked(stored, id);
                  return (
                    // A disabled button gets no pointer events, so the reason sits on its wrapper.
                    <span
                      key={id}
                      className="inline-flex items-center gap-1"
                      title={blocked ? `A command of yours is named ${shippedName(id)}: rename it to restore this one.` : undefined}
                    >
                      {shippedName(id)} —
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        disabled={blocked}
                        onClick={() => restore(id)}
                      >
                        Restore
                      </Button>
                    </span>
                  );
                })}
              </p>
            )}
          </>
        )}
      </CardContent>
      {editing !== undefined && settings.data && (
        <CommandDialog command={editing} settings={settings.data} write={write} onClose={() => setEditing(undefined)} />
      )}
      {importing !== null && <ImportCommandsDialog peer={importing} write={write} onClose={() => setImporting(null)} />}
    </Card>
  );
}
