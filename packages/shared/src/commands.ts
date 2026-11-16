import { z } from "zod";
import { EFFORTS, MODELS, type Effort, type Model } from "./models";

/**
 * The icons a command may carry: lucide names, kebab-case. Here so the server can validate the
 * assistant's pick; the web maps each to its component in one table.
 */
export const COMMAND_ICONS = [
  "brush-cleaning", "zap", "package", "rocket", "bug", "wrench", "hammer", "terminal",
  "git-branch", "git-merge", "git-pull-request", "flask-conical", "shield-check", "shield",
  "search", "file-text", "book-open", "trash-2", "refresh-cw", "download", "upload",
  "database", "server", "cloud", "globe", "lock", "key", "bell", "mail", "message-square",
  "play", "list-checks", "sparkles", "wand-sparkles", "gauge", "bot", "code", "braces",
  "folder", "archive", "tag", "flag", "eye", "layers", "puzzle", "paintbrush", "settings",
] as const;
export type CommandIcon = (typeof COMMAND_ICONS)[number];

/** A quick command: a prompt that opens a session in a project (RIC-581). */
export interface Command {
  /** A default's plain word (`clean`), or `cmd-<hex6>` for a custom one. */
  id: string;
  name: string;
  prompt: string;
  icon: CommandIcon;
  /** Null = offered on every mapped project but those in `excluded`. */
  project: string | null;
  /**
   * The projects a general command is not offered on (RIC-587): unique, plain-`sort()`ed, and `[]`
   * for a project's own command — `CommandSchema` keeps it so.
   */
  excluded: string[];
  model: Model;
  effort: Effort;
}

/** The stored form: custom commands and edited copies of defaults, plus the removed defaults' ids. */
export interface CommandsSetting {
  items: Command[];
  removed: string[];
}

/** Frozen, arrays too: it is shared, and a push into it would leak into every later read. */
export const EMPTY_COMMANDS: CommandsSetting = Object.freeze({
  items: Object.freeze([]) as unknown as Command[],
  removed: Object.freeze([]) as unknown as string[],
});

/**
 * A command's prompt is passed to claude as one argv entry of `tmux new-session`, and tmux refuses
 * a command over ~16 KB ("command too long"; 15 000 characters run, 17 000 fail on tmux 3.7c).
 * Half of that leaves room for the rest of the command line and for multi-byte characters.
 */
export const COMMAND_PROMPT_MAX = 8000;

/**
 * The whole prompt of a project's Clean session (`launchClean`): merged branches, local and on
 * origin, and the worktrees of merged branches, deleted only after the human confirms the list
 * in the terminal. "Merged" includes squash and rebase merges, which `git branch --merged` does
 * not see — the reason this is a Claude session and not a git command. Fixed, not a setting.
 * Ticket sessions share the checkout and live sessions hold their worktrees (Claude Code locks
 * them), hence the list of things never touched.
 */
export const CLEAN_PROMPT = [
  "Clean up this repository: delete the branches that have been merged, locally and on origin, and remove the git worktrees of merged branches.",
  "1. Run `git fetch --prune origin` so the remote-tracking branches are current, and find the default branch (origin/HEAD).",
  "2. Find the candidates: local branches merged into the default branch, branches on origin merged into it, and linked worktrees whose branch is merged. Merged includes squash and rebase merges, which `git branch --merged` does not see: check whether a branch's changes are already in the default branch (`git cherry`, or a merged pull request via `gh` if it is available).",
  "3. Never touch: the default branch; the branch checked out in this checkout; a branch with commits that are not in the default branch; a worktree that is locked (a running Claude session holds it) or has uncommitted or untracked changes, nor its branch. List these separately, each with the reason it stays.",
  "4. Show me the list grouped as worktrees, local branches and remote branches, then stop and wait for my confirmation before deleting anything. Delete only what I confirm.",
  "5. Then remove the worktrees with `git worktree remove` (never --force), delete the local branches with `git branch -d` (`-D` only for a branch you verified was squash- or rebase-merged), delete the remote ones with `git push origin --delete`, and finish with `git worktree prune`. Report what was deleted and what was left.",
  "Other Claude sessions may be working in this same checkout: never switch its branch, never stash, reset or discard changes, and never force-push. If something is unclear, ask me rather than guess.",
].join("\n");

export const DEFAULT_COMMANDS: readonly Command[] = [
  { id: "clean", name: "Clean", icon: "brush-cleaning", project: null, excluded: [], model: "sonnet", effort: "high", prompt: CLEAN_PROMPT },
];

const CUSTOM_ID = /^cmd-[0-9a-f]{6}$/;

export const isDefaultCommandId = (id: string): boolean => DEFAULT_COMMANDS.some((c) => c.id === id);
export const isCustomCommandId = (id: string): boolean => CUSTOM_ID.test(id);

export function newCommandId(
  random: () => string = () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0"),
): string {
  return `cmd-${random()}`;
}

/** Unique and plain-`sort()`ed (never the device's locale: the stored form compares as strings). */
export const canonicalExcluded = (names: readonly string[]): string[] => [...new Set(names)].sort();

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
  })
  .transform((c): Command => ({ ...c, excluded: c.project === null ? canonicalExcluded(c.excluded) : [] }));

const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * The commands in force: each default in shipped order (its stored edit if any, none if removed),
 * then the custom items in stored order. An unedited default (no stored copy) whose shipped name a
 * stored command already uses is left out: the human's own command wins. An edited default is
 * never hidden by a name — it is the human's too, and hidden it could not be edited, reset or
 * restored; a clash with it is refused on write instead (`CommandsSettingBody`).
 */
export function effectiveCommands(s: CommandsSetting): Command[] {
  const customs = s.items.filter((c) => isCustomCommandId(c.id));
  const defaults = DEFAULT_COMMANDS.flatMap((d) => {
    if (s.removed.includes(d.id)) return [];
    const edited = s.items.find((c) => c.id === d.id);
    if (edited) return [edited];
    return s.items.some((c) => nameKey(c.name) === nameKey(d.name)) ? [] : [d];
  });
  return [...defaults, ...customs];
}

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
      const key = nameKey(c.name);
      if (names.has(key)) ctx.addIssue({ code: "custom", path: ["items"], message: `duplicate command name: ${c.name}` });
      names.add(key);
    }
  });

/** The commands offered in a project: the general ones that do not exclude it, and the project's own. */
export function commandsFor(effective: Command[], project: string): Command[] {
  return effective.filter((c) => (c.project === null ? !c.excluded.includes(project) : c.project === project));
}

const sameCommand = (a: Command, b: Command): boolean =>
  a.id === b.id && a.name === b.name && a.prompt === b.prompt && a.icon === b.icon &&
  a.project === b.project && a.model === b.model && a.effort === b.effort &&
  a.excluded.length === b.excluded.length && a.excluded.every((p, i) => p === b.excluded[i]);

/** Drops items equal to their default, then removed ids that are no default or still have an item. */
export function normalizeCommands(s: CommandsSetting): CommandsSetting {
  const items = s.items.filter((c) => !DEFAULT_COMMANDS.some((d) => sameCommand(c, d)));
  const removed = s.removed.filter((id, i) => isDefaultCommandId(id) && !items.some((c) => c.id === id) && s.removed.indexOf(id) === i);
  return { items, removed };
}

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
    else if (names.has(nameKey(command.name))) problems.push(`item ${i} dropped (repeated name ${command.name})`);
    else {
      names.add(nameKey(command.name));
      items.push(command);
    }
  }
  if (problems.length > 0) warn?.(problems.join("; "));
  const removed = (rawRemoved ?? []).filter((r): r is string => typeof r === "string");
  return normalizeCommands({ items, removed });
}

/** A project's own commands move with its rename, and its name is renamed where it is excluded. */
export function renameCommandsProject(s: CommandsSetting, from: string, to: string): CommandsSetting {
  const items = s.items.map((c) => {
    if (c.project === from) return { ...c, project: to };
    if (c.excluded.includes(from)) return { ...c, excluded: canonicalExcluded(c.excluded.map((p) => (p === from ? to : p))) };
    return c;
  });
  return { ...s, items };
}

/**
 * Deletes the project's custom commands and drops its edited defaults (the shipped one returns);
 * its name leaves every `excluded`, so a default edited only to skip it is the default again.
 */
export function removeCommandsProject(s: CommandsSetting, project: string): CommandsSetting {
  const items = s.items
    .filter((c) => c.project !== project)
    .map((c) => (c.excluded.includes(project) ? { ...c, excluded: c.excluded.filter((p) => p !== project) } : c));
  return normalizeCommands({ ...s, items });
}

/**
 * Merges commands read from another instance into the stored setting. Per incoming command: a
 * local one with the same id, else the same name, is replaced keeping the local id; no match adds
 * it (a custom id kept, a default id this version does not ship gets a fresh one).
 */
export function importCommands(local: CommandsSetting, incoming: Command[], random?: () => string): CommandsSetting {
  const items = [...local.items];
  let removed = [...local.removed];
  for (const cmd of incoming) {
    const current = effectiveCommands({ items, removed });
    const match = current.find((c) => c.id === cmd.id) ?? current.find((c) => nameKey(c.name) === nameKey(cmd.name));
    let id: string;
    if (match) id = match.id;
    else if (isDefaultCommandId(cmd.id) || (isCustomCommandId(cmd.id) && !items.some((c) => c.id === cmd.id))) id = cmd.id;
    else {
      do id = newCommandId(random);
      while (items.some((c) => c.id === id));
    }
    removed = removed.filter((r) => r !== id);
    const next = { ...cmd, id };
    const at = items.findIndex((c) => c.id === id);
    if (at >= 0) items[at] = next;
    else items.push(next);
  }
  return normalizeCommands({ items, removed });
}

/** The system prompt of the command form's AI help: fixed, not a setting. One line per paragraph. */
export const ASSIST_PROMPT = [
  "You help write a quick command for Mojito: a prompt that starts a Claude Code session working in a project's git repository.",
  "The user gives you a rough idea or a finished prompt. Rewrite it as a clear, self-contained instruction in English for that session.",
  "Keep the user's intent and every constraint they state; do not add goals they did not ask for.",
  "Where the work could be destructive (deleting, force-pushing, resetting, discarding changes), tell the session to stop and ask the human before doing it.",
  `Keep the prompt under ${COMMAND_PROMPT_MAX} characters.`,
  "Propose a short name for the command (at most 40 characters) and pick exactly one icon from the list in the message.",
  'Answer with JSON only, no prose and no code fence: {"name": string, "prompt": string, "icon": string}.',
].join("\n");

export const AssistBody = z.object({
  text: z.string().trim().min(1).max(20000),
  project: z.string().optional(),
  /** The form's current icon: the fallback when the assistant picks one outside the list. */
  icon: z.enum(COMMAND_ICONS).optional(),
});
export type AssistBody = z.infer<typeof AssistBody>;

export interface AssistAnswer {
  name: string;
  prompt: string;
  icon: CommandIcon;
}
