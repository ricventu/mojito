import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, RotateCcw, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { COMMAND_PROMPT_MAX, isDefaultCommandId, type AssistAnswer, type AssistBody, type Command, type CommandsSetting, type Settings } from "@mojito/shared";
import { LaunchOptions } from "@/components/sheets/LaunchOptions";
import { SHEET_CONTENT_CLASS } from "@/components/sheets/styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useProjects } from "@/hooks/useProjects";
import { apiJson } from "@/lib/api";
import { byProjectName } from "@/lib/board";
import {
  applyAssist,
  commandTag,
  deleteCommand,
  draftError,
  duplicateDraft,
  newDraft,
  resetDefault,
  saveDraft,
  skipOptions,
  toggleExcluded,
  type CommandDraft,
} from "@/lib/commandForm";
import { FALLBACK } from "@/lib/launch";
import { IconGrid } from "./IconGrid";

/** A select item cannot have an empty value, so "All projects" travels under this one. */
const ALL = "__all__";

/** Applies `update` to the stored commands current when the write runs, and PUTs the result. */
export type CommandsWrite = (update: (s: CommandsSetting) => CommandsSetting) => Promise<unknown>;

interface FormState {
  draft: CommandDraft;
  /** The draft before the last AI answer, for one Undo; any edit or a save drops it. */
  undo: CommandDraft | null;
}

interface Props {
  /** The command being edited; `null` adds a new one. */
  command: Command | null;
  settings: Settings;
  write: CommandsWrite;
  onClose: () => void;
}

interface FormProps extends Props {
  /** A new command's starting fields (a duplicate's), instead of an empty form. */
  initial?: CommandDraft;
  onDuplicate: (copy: CommandDraft) => void;
}

function Form({ command, settings, write, onClose, initial, onDuplicate }: FormProps) {
  const projects = useProjects();
  const [form, setForm] = useState<FormState>(() => ({
    draft: initial ?? command ?? newDraft(settings.statusDefaults["In Progress"] ?? FALLBACK),
    undo: null,
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the AI should write, asked for when "Write with AI" is tapped; null while not asking. */
  const [idea, setIdea] = useState<string | null>(null);
  const { draft, undo } = form;
  const tag = command ? commandTag(settings.commands, command.id) : null;

  // A function patch reads the latest draft: two quick ticks must both land.
  const edit = (patch: Partial<CommandDraft> | ((d: CommandDraft) => Partial<CommandDraft>)) =>
    setForm((f) => ({ draft: { ...f.draft, ...(typeof patch === "function" ? patch(f.draft) : patch) }, undo: null }));

  const assist = useMutation({
    mutationFn: (body: AssistBody) => apiJson<AssistAnswer>("/api/commands/assist", "POST", body),
    onSuccess: (answer) => {
      setForm((f) => ({ draft: applyAssist(f.draft, answer), undo: f.draft }));
      setIdea(null);
    },
  });

  // A project the server no longer maps still shows, so opening the dialog never changes the command.
  const mapped = (projects.data ?? []).map((p) => p.name);
  const projectChoices = [...new Set(draft.project ? [...mapped, draft.project] : mapped)].sort(byProjectName);
  const skipChoices = draft.project === null ? skipOptions(mapped, draft.excluded) : [];

  async function run(update: (s: CommandsSetting) => CommandsSetting, done: string) {
    setError(null);
    setBusy(true);
    try {
      await write(update);
      toast.success(done);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving the command failed.");
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setForm((f) => ({ ...f, undo: null }));
    // Checked against the setting the write starts from; a refusal throws before any PUT.
    void run((s) => {
      const why = draftError(s, draft);
      if (why) throw new Error(why);
      return saveDraft(s, draft);
    }, "Command saved");
  }

  const pending = busy || assist.isPending;

  const generate = (text: string) => assist.mutate({ text, project: draft.project ?? undefined, icon: draft.icon });

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4 px-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="command-name">Name</Label>
        <Input
          id="command-name"
          value={draft.name}
          maxLength={40}
          onChange={(e) => edit({ name: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="command-project">Project</Label>
        <Select value={draft.project ?? ALL} onValueChange={(v) => edit({ project: v === ALL ? null : v })}>
          <SelectTrigger id="command-project" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projectChoices.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {draft.project === null && (skipChoices.length > 0 || draft.excluded.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="command-skip">Skip on</Label>
          {skipChoices.length > 0 && (
            // Keyed on the list so it remounts empty after each pick: it adds, it holds no value.
            <Select
              key={draft.excluded.join("\u0000")}
              onValueChange={(name) => edit((d) => ({ excluded: toggleExcluded(d.excluded, name, true) }))}
            >
              <SelectTrigger id="command-skip" className="w-full">
                <SelectValue placeholder="Add a project to skip" />
              </SelectTrigger>
              <SelectContent>
                {skipChoices.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {draft.excluded.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {[...draft.excluded].sort(byProjectName).map((name) => (
                <li key={name} className="min-w-0">
                  <Badge variant="secondary" className="max-w-full gap-1 pr-0.5">
                    <span className="truncate">{name}</span>
                    <button
                      type="button"
                      aria-label={`Offer on ${name} again`}
                      onClick={() => edit((d) => ({ excluded: toggleExcluded(d.excluded, name, false) }))}
                      className="rounded-sm p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <X size={12} />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="command-prompt">Prompt</Label>
        <Textarea
          id="command-prompt"
          value={draft.prompt}
          maxLength={COMMAND_PROMPT_MAX}
          readOnly={assist.isPending}
          onChange={(e) => edit({ prompt: e.target.value })}
          placeholder="What the session should do, roughly or in full"
          className="max-h-[40dvh] min-h-24"
        />
        {idea === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setIdea("")}>
              <Sparkles size={14} /> Write with AI
            </Button>
            {undo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ draft: undo, undo: null })}>
                <Undo2 size={14} /> Undo
              </Button>
            )}
          </div>
        ) : (
          // Asked first: the idea is its own text, so the prompt above stays as it is until the answer.
          <div className="flex flex-col gap-1.5 rounded-md border p-3">
            <Label htmlFor="command-idea">What should this command do?</Label>
            <Textarea
              id="command-idea"
              autoFocus
              value={idea}
              readOnly={assist.isPending}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter generates; a plain Enter is a new line, and never submits the form.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && idea.trim() !== "" && !pending) {
                  e.preventDefault();
                  generate(idea);
                }
              }}
              placeholder="e.g. update the dependencies, run the tests, open a PR"
              className="max-h-[30dvh] min-h-20"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={assist.isPending}
                onClick={() => {
                  setIdea(null);
                  assist.reset();
                }}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={idea.trim() === "" || pending} onClick={() => generate(idea)}>
                {assist.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {assist.isPending ? "Writing…" : "Generate"}
              </Button>
            </div>
            {assist.isError && (
              <p role="alert" className="text-sm text-destructive">
                {assist.error.message}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="command-icon-label" className="text-sm leading-none font-medium">
          Icon
        </span>
        <IconGrid value={draft.icon} onChange={(icon) => edit({ icon })} labelledBy="command-icon-label" />
      </div>
      <LaunchOptions
        idPrefix="command"
        model={draft.model}
        effort={draft.effort}
        onModel={(model) => edit({ model })}
        onEffort={(effort) => edit({ effort })}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <SheetFooter className="flex-row flex-wrap justify-end gap-2 p-0">
        {command && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-destructive"
            disabled={pending}
            onClick={() => {
              // A default can be restored from the card; a custom command cannot.
              if (!isDefaultCommandId(command.id) && !window.confirm(`Delete the command ${command.name}?`)) return;
              void run((s) => deleteCommand(s, command.id), `Deleted ${command.name}`);
            }}
          >
            <Trash2 size={16} /> Delete
          </Button>
        )}
        {command && tag === "Edited" && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void run((s) => resetDefault(s, command.id), `${command.name} reset to default`)}
          >
            <RotateCcw size={16} /> Reset to default
          </Button>
        )}
        {command && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => onDuplicate(duplicateDraft(settings.commands, draft))}>
            <Copy size={16} /> Duplicate
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/**
 * Add or edit one quick command; mounted per opening, so it never shows the last one's fields.
 * Duplicate turns it into a new command holding a copy of the form (RIC-587): the original stays
 * as stored, and the copy is written only by its own Save.
 */
export function CommandDialog(props: Props) {
  const [copy, setCopy] = useState<{ of: string; draft: CommandDraft } | null>(null);
  const command = copy ? null : props.command;
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="bottom" className={SHEET_CONTENT_CLASS}>
        <SheetHeader className="pr-12">
          <SheetTitle>{command ? "Edit command" : "New command"}</SheetTitle>
          <SheetDescription>
            {copy ? `A copy of ${copy.of}, added when you save it.` : "A prompt that opens a Claude session in a project."}
          </SheetDescription>
        </SheetHeader>
        <Form
          key={copy ? "copy" : "edit"}
          {...props}
          command={command}
          initial={copy?.draft}
          onDuplicate={(draft) => setCopy({ of: props.command?.name ?? draft.name, draft })}
        />
      </SheetContent>
    </Sheet>
  );
}
