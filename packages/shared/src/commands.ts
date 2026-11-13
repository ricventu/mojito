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
  /** Null = offered on every mapped project. */
  project: string | null;
  model: Model;
  effort: Effort;
}

/** The stored form: custom commands and edited copies of defaults, plus the removed defaults' ids. */
export interface CommandsSetting {
  items: Command[];
  removed: string[];
}

export const EMPTY_COMMANDS: CommandsSetting = { items: [], removed: [] };

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
  { id: "clean", name: "Clean", icon: "brush-cleaning", project: null, model: "sonnet", effort: "high", prompt: CLEAN_PROMPT },
];

const CUSTOM_ID = /^cmd-[0-9a-f]{6}$/;

export const isDefaultCommandId = (id: string): boolean => DEFAULT_COMMANDS.some((c) => c.id === id);
export const isCustomCommandId = (id: string): boolean => CUSTOM_ID.test(id);

export function newCommandId(
  random: () => string = () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0"),
): string {
  return `cmd-${random()}`;
}

export const CommandSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(40),
  prompt: z.string().min(1).max(20000),
  icon: z.enum(COMMAND_ICONS),
  project: z.string().min(1).nullable(),
  model: z.enum(MODELS),
  effort: z.enum(EFFORTS),
});

const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * The commands in force: each default in shipped order (its stored edit if any, none if removed),
 * then the custom items in stored order. A default whose name a custom command already uses is
 * left out: the human's own command wins.
 */
export function effectiveCommands(s: CommandsSetting): Command[] {
  const customs = s.items.filter((c) => isCustomCommandId(c.id));
  const customNames = new Set(customs.map((c) => nameKey(c.name)));
  const defaults = DEFAULT_COMMANDS.flatMap((d) => {
    if (s.removed.includes(d.id)) return [];
    const shown = s.items.find((c) => c.id === d.id) ?? d;
    return customNames.has(nameKey(shown.name)) || customNames.has(nameKey(d.name)) ? [] : [shown];
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

/** The commands offered in a project: global ones and the project's own. */
export function commandsFor(effective: Command[], project: string): Command[] {
  return effective.filter((c) => c.project === null || c.project === project);
}

const sameCommand = (a: Command, b: Command): boolean =>
  a.id === b.id && a.name === b.name && a.prompt === b.prompt && a.icon === b.icon &&
  a.project === b.project && a.model === b.model && a.effort === b.effort;

/** Drops items equal to their default, then removed ids that are no default or still have an item. */
export function normalizeCommands(s: CommandsSetting): CommandsSetting {
  const items = s.items.filter((c) => !DEFAULT_COMMANDS.some((d) => sameCommand(c, d)));
  const removed = s.removed.filter((id, i) => isDefaultCommandId(id) && !items.some((c) => c.id === id) && s.removed.indexOf(id) === i);
  return { items, removed };
}

export function renameCommandsProject(s: CommandsSetting, from: string, to: string): CommandsSetting {
  return { ...s, items: s.items.map((c) => (c.project === from ? { ...c, project: to } : c)) };
}

/** Deletes the project's custom commands and drops its edited defaults (the shipped one returns). */
export function removeCommandsProject(s: CommandsSetting, project: string): CommandsSetting {
  return normalizeCommands({ ...s, items: s.items.filter((c) => c.project !== project) });
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
