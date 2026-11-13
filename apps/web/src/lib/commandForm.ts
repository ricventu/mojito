import {
  COMMAND_ICONS,
  CommandSchema,
  DEFAULT_COMMANDS,
  effectiveCommands,
  isDefaultCommandId,
  isCustomCommandId,
  newCommandId,
  normalizeCommands,
  type AssistAnswer,
  type Command,
  type CommandsSetting,
  type Effort,
  type Model,
} from "@mojito/shared";
import { ApiError } from "@/lib/api";
import { byProjectName } from "@/lib/board";

/**
 * Settings → Commands (RIC-581): the edits the card and its dialog make to the stored `commands`
 * setting. Each takes the setting current at the moment of the write and answers the whole new
 * one, normalized (a default equal to its shipped form is not stored), ready to PUT.
 */

/** The dialog's fields; `id` is null until a new command's first save gives it one. */
export type CommandDraft = Omit<Command, "id"> & { id: string | null };

const nameKey = (name: string): string => name.trim().toLowerCase();

/** A new command: no name or prompt yet, the zap icon, the new-session sheet's model and effort. */
export function newDraft(defaults: { model: Model; effort: Effort }, project?: string): CommandDraft {
  return { id: null, name: "", prompt: "", icon: "zap", project: project ?? null, model: defaults.model, effort: defaults.effort };
}

/** The AI help's answer in the form: prompt and icon always, the name only when there is none to keep. */
export function applyAssist(draft: CommandDraft, answer: AssistAnswer): CommandDraft {
  const name = draft.id === null || draft.name.trim() === "" ? answer.name : draft.name;
  return { ...draft, name, prompt: answer.prompt, icon: answer.icon };
}

/** Why Save must refuse the draft, or null. A name clash is checked against the commands in force. */
export function draftError(s: CommandsSetting, draft: CommandDraft): string | null {
  const name = draft.name.trim();
  if (name === "") return "The name is required.";
  if (draft.prompt.trim() === "") return "The prompt is required.";
  const clash = effectiveCommands(s).some((c) => c.id !== draft.id && nameKey(c.name) === nameKey(name));
  return clash ? `A command named ${name} already exists.` : null;
}

/**
 * The setting with the draft saved: a new one appended under a fresh `cmd-` id, an existing one
 * replaced in place (a default's first edit stored as its copy, under its own id).
 */
export function saveDraft(s: CommandsSetting, draft: CommandDraft, random?: () => string): CommandsSetting {
  let id = draft.id;
  if (id === null) {
    do id = newCommandId(random);
    while (s.items.some((c) => c.id === id));
  }
  const command: Command = { ...draft, id, name: draft.name.trim() };
  const at = s.items.findIndex((c) => c.id === id);
  const items = at >= 0 ? s.items.map((c, i) => (i === at ? command : c)) : [...s.items, command];
  return normalizeCommands({ ...s, items });
}

/** A default is recorded as removed (restorable), a custom command is gone. */
export function deleteCommand(s: CommandsSetting, id: string): CommandsSetting {
  const items = s.items.filter((c) => c.id !== id);
  const removed = isDefaultCommandId(id) ? [...s.removed, id] : s.removed;
  return normalizeCommands({ items, removed });
}

/** An edited default back to its shipped form. */
export function resetDefault(s: CommandsSetting, id: string): CommandsSetting {
  return normalizeCommands({ ...s, items: s.items.filter((c) => c.id !== id) });
}

/** A removed default back in the list. */
export function restoreDefault(s: CommandsSetting, id: string): CommandsSetting {
  return normalizeCommands({ ...s, removed: s.removed.filter((r) => r !== id) });
}

/**
 * A removed default cannot come back while a custom command uses its name: it would stay hidden
 * behind it (`effectiveCommands`), so Restore would seem to do nothing.
 */
export function restoreBlocked(s: CommandsSetting, id: string): boolean {
  const shipped = DEFAULT_COMMANDS.find((d) => d.id === id);
  if (!shipped) return false;
  return s.items.some((c) => isCustomCommandId(c.id) && nameKey(c.name) === nameKey(shipped.name));
}

/** The card's groups: "All projects" (null) first, then each project by name; list order inside. */
export function commandGroups(effective: Command[]): { project: string | null; commands: Command[] }[] {
  const byProject = new Map<string | null, Command[]>();
  for (const c of effective) byProject.set(c.project, [...(byProject.get(c.project) ?? []), c]);
  const projects = [...byProject.keys()].filter((p): p is string => p !== null).sort(byProjectName);
  const order = byProject.has(null) ? [null, ...projects] : projects;
  return order.map((project) => ({ project, commands: byProject.get(project)! }));
}

/** A default's tag: as shipped, or edited (then it can be reset). A custom command has none. */
export function commandTag(s: CommandsSetting, id: string): "Default" | "Edited" | null {
  if (!isDefaultCommandId(id)) return null;
  return s.items.some((c) => c.id === id) ? "Edited" : "Default";
}

/** A peer's commands for the import list: one bound to a project this instance does not map is disabled. */
export function importableRows(
  incoming: Command[],
  mapped: string[],
): { command: Command; disabledReason: string | null }[] {
  return incoming.map((command) => ({
    command,
    disabledReason: command.project !== null && !mapped.includes(command.project) ? `${command.project} is not mapped here` : null,
  }));
}

/** Why reading a peer's commands failed; a 404 is an older Mojito without the route. */
export function importErrorMessage(peer: string, err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return `${peer} has no commands to import`;
  return err instanceof Error ? err.message : `Reading ${peer}'s commands failed.`;
}

/**
 * A peer's `GET /api/commands` answer, made safe to show and import: anything but `{commands: [...]}`
 * is empty; an icon this build does not know becomes the zap (a newer peer's command stays
 * importable); an item that is not a valid command, or whose id is neither a plain word nor a
 * custom `cmd-` id, is dropped; a repeated id keeps its first.
 */
export function peerCommands(body: unknown): Command[] {
  const list = typeof body === "object" && body !== null ? (body as { commands?: unknown }).commands : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const icon = (COMMAND_ICONS as readonly unknown[]).includes(item.icon) ? item.icon : "zap";
    const parsed = CommandSchema.safeParse({ ...item, icon });
    if (!parsed.success) continue;
    const command = parsed.data;
    if (!/^[a-z]+$/.test(command.id) && !isCustomCommandId(command.id)) continue;
    if (seen.has(command.id)) continue;
    seen.add(command.id);
    out.push(command);
  }
  return out;
}
