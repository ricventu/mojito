import { z } from "zod";
import { EFFORTS, MODELS } from "./models";
import {
  canonicalExcluded,
  COMMAND_ICONS,
  COMMAND_PROMPT_MAX,
  EMPTY_COMMANDS,
  effectiveCommands,
  isCustomCommandId,
  isDefaultCommandId,
  commandNameKey,
  normalizeCommands,
  type Command,
  type CommandsSetting,
} from "./commands";

/*
 * The commands' zod schemas and what needs them, apart from `commands.ts`: the board imports the
 * commands' plain functions, and a module that builds a schema at load keeps zod in its bundle.
 */

/**
 * One command. `excluded` is absent in a command stored before RIC-587 or read from an older peer
 * (then `[]`), and is canonicalised here, so every reader — a write, the stored setting, an import —
 * holds the same form: `[]` for a project's own command, else `canonicalExcluded`.
 */
export const CommandSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1).max(40),
    prompt: z.string().min(1).max(COMMAND_PROMPT_MAX),
    icon: z.enum(COMMAND_ICONS),
    project: z.string().min(1).nullable(),
    excluded: z.array(z.string().min(1)).max(100).default([]),
    model: z.enum(MODELS),
    effort: z.enum(EFFORTS),
    worktree: z.boolean().default(false),
  })
  .transform((c): Command => ({ ...c, excluded: c.project === null ? canonicalExcluded(c.excluded) : [] }));

/**
 * `POST /api/projects/:name/commands/:id/run` (RIC-622): the command as the sender has it and the
 * run sheet's picks. On a peer the command is the sender's, so nothing is looked up by id.
 */
export const CommandRunBody = z.object({
  prompt: z.string().min(1).max(COMMAND_PROMPT_MAX),
  model: z.enum(MODELS),
  effort: z.enum(EFFORTS),
  worktree: z.boolean(),
});
export type CommandRunBody = z.infer<typeof CommandRunBody>;

export const CommandsSettingBody = z
  .object({
    items: z.array(CommandSchema).max(100),
    removed: z.array(z.string()).max(50),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const [i, c] of value.items.entries()) {
      if (!isCustomCommandId(c.id) && !isDefaultCommandId(c.id)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: "unknown command id" });
      }
      if (ids.has(c.id)) ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: "duplicate command id" });
      ids.add(c.id);
    }
    const names = new Set<string>();
    for (const c of effectiveCommands(value)) {
      const key = commandNameKey(c.name);
      if (names.has(key)) ctx.addIssue({ code: "custom", path: ["items"], message: `duplicate command name: ${c.name}` });
      names.add(key);
    }
  });

const PLAIN_ID = /^[a-z]+$/;
/**
 * One command read from outside a write's validation (the stored setting, a peer's list), made
 * safe: an icon this build does not know becomes the zap, then it must be a valid command whose id
 * is a plain word (a default's shape, perhaps one this version does not ship) or a `cmd-` id.
 */
export function sanitizeCommand(raw: unknown): Command | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const icon = (COMMAND_ICONS as readonly unknown[]).includes(item.icon) ? item.icon : "zap";
  const parsed = CommandSchema.safeParse({ ...item, icon });
  if (!parsed.success) return null;
  return PLAIN_ID.test(parsed.data.id) || isCustomCommandId(parsed.data.id) ? parsed.data : null;
}

/**
 * The stored `commands` setting, read leniently. Rules change between versions (an icon dropped, a
 * cap lowered, a new default named like a stored command), and a value that no longer passes
 * `CommandsSettingBody` must not be served empty: the next write would wipe the human's commands.
 * Each item is sanitized (`sanitizeCommand`) and must carry a shipped default's id or a `cmd-` id,
 * else it alone is dropped; a repeated id keeps its first, a repeated name (trimmed, any case) its
 * first; `removed` keeps its strings. Not an object, or no lists, answers none. `warn` is called at
 * most once per read, with every problem found.
 */
export function readCommandsSetting(raw: unknown, warn?: (problem: string) => void): CommandsSetting {
  const value = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as { items?: unknown; removed?: unknown }) : null;
  const rawItems = Array.isArray(value?.items) ? (value.items as unknown[]) : null;
  const rawRemoved = Array.isArray(value?.removed) ? (value.removed as unknown[]) : null;
  if (!rawItems && !rawRemoved) {
    warn?.(value ? "no items or removed list" : "not an object");
    return EMPTY_COMMANDS;
  }
  const problems: string[] = [];
  if (!rawItems) problems.push("items is not a list");
  if (!rawRemoved) problems.push("removed is not a list");
  const items: Command[] = [];
  const names = new Set<string>();
  for (const [i, entry] of (rawItems ?? []).entries()) {
    const command = sanitizeCommand(entry);
    if (!command || (!isDefaultCommandId(command.id) && !isCustomCommandId(command.id))) problems.push(`item ${i} dropped (not a valid command)`);
    else if (items.some((c) => c.id === command.id)) problems.push(`item ${i} dropped (repeated id ${command.id})`);
    else if (names.has(commandNameKey(command.name))) problems.push(`item ${i} dropped (repeated name ${command.name})`);
    else {
      names.add(commandNameKey(command.name));
      items.push(command);
    }
  }
  if (problems.length > 0) warn?.(problems.join("; "));
  const removed = (rawRemoved ?? []).filter((r): r is string => typeof r === "string");
  return normalizeCommands({ items, removed });
}

export const AssistBody = z.object({
  text: z.string().trim().min(1).max(20000),
  /** The form's prompt as it stands: when not blank, `text` is a change to it, not a new command. */
  prompt: z.string().max(COMMAND_PROMPT_MAX).optional(),
  project: z.string().optional(),
  /** The form's current icon: the fallback when the assistant picks one outside the list. */
  icon: z.enum(COMMAND_ICONS).optional(),
});
export type AssistBody = z.infer<typeof AssistBody>;
