import type { StackRow } from "./stacks";

/**
 * One button in a project section's management toolbar (RIC-253) — the actions the
 * Stacks tab used to hold, moved onto the divider that already names the project.
 *
 * `logs` and `deploy` are the two that are not a `/api/stacks/<slug>/<action>` POST:
 * logs opens the stack's tmux session in a terminal, and deploy runs the guarded
 * self-update flow (banner + health poll + reload) instead of a raw pull.
 */
export type ProjectAction =
  | "start"
  | "stop"
  | "logs"
  | "pull"
  | "deploy"
  | "push"
  | "init-script";

/**
 * The stack row for a project section, or null when the section has none.
 *
 * A board section is not always a mapped project: it can be the NO_PROJECT bucket, or
 * a project whose name a *session* still carries after projects.json dropped it (see
 * mergedProjects). Neither has a repo path to act on, so neither gets a toolbar.
 */
export function stackFor(stacks: readonly StackRow[], project: string): StackRow | null {
  return stacks.find((s) => s.project === project) ?? null;
}

/**
 * Which actions a project's toolbar offers, in render order.
 *
 * The rules are the Stacks panel's own, kept whole:
 *
 * - Start only when the stack is not already running; **Stop always**, because
 *   detection can read "crashed"/"stopped" while orphan processes still hold the
 *   ports, and the user must always be able to force a clean stop.
 * - Logs whenever there is a stack to have logs.
 * - Pull only on a pullable checkout, and `deploy` only on the server's own — the two
 *   are mutually exclusive by construction (`pullable` is `path !== selfPath` and
 *   `self` is `path === selfPath`), so a row never shows both. Mojito's own checkout
 *   has a post-merge hook that starts the deploy unit, which is why its pull is the
 *   guarded self-update flow rather than the raw one.
 * - Push on any mapped project: a push fires no post-merge hook, so the hazard that
 *   makes the self-row unpullable does not apply to it.
 * - "Create worktree script" only while the repo has no `scripts/init-worktree.sh` —
 *   the one action here that answers a question rather than repeating a chore, so once
 *   the script exists the button is noise.
 *
 * `canDeploy` mirrors MOJITO_SELF_UPDATE (see useSelfUpdate.enabled): with the endpoint
 * off, nothing should render the control.
 */
export function projectActions(stack: StackRow | null, canDeploy: boolean): ProjectAction[] {
  if (!stack) return [];
  const actions: ProjectAction[] = [];
  if (stack.hasStack) {
    if (stack.status !== "running") actions.push("start");
    actions.push("stop", "logs");
  }
  if (stack.pullable) actions.push("pull");
  if (stack.self && canDeploy) actions.push("deploy");
  actions.push("push");
  if (!stack.hasWorktreeScript) actions.push("init-script");
  return actions;
}
