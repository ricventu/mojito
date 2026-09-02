import { vscodeUrl, warpUrl } from "./openInApp";
import type { StackRow } from "./stacks";

/**
 * One button in a project section's management toolbar (RIC-253) — the actions the
 * Stacks tab used to hold, moved onto the divider that already names the project.
 *
 * Most are a `/api/stacks/<slug>/<action>` POST. The exceptions are worth knowing:
 * `logs` opens the stack's tmux session in a terminal; `deploy` runs the guarded
 * self-update flow (banner + health poll + reload) instead of a raw pull; `ticket`
 * opens the New ticket sheet on this project; and `warp`/`vscode` are not requests at
 * all but anchors handing the repo root to the OS (see openInApp).
 *
 * Those last three are the terminal header's own actions, in its own order, offered
 * here as well: a project's divider names the repo the header's cwd usually *is*, and
 * reaching them used to mean opening one of its sessions first.
 *
 * `deploy` and `claude-deploy` are **not** two names for one thing. `deploy` is
 * Mojito's own guarded self-update — pull, rebuild, restart *this* server — and exists
 * only on the checkout it runs from. `claude-deploy` opens a Claude session in the
 * project root and asks it to deploy to production, which is whatever that repo's own
 * procedure is; Mojito neither knows nor guesses it. So the self-row shows both, and
 * they mean different machines.
 */
export type ProjectAction =
  | "warp"
  | "vscode"
  | "ticket"
  | "start"
  | "stop"
  | "logs"
  | "pull"
  | "deploy"
  | "push"
  | "claude-deploy"
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
 * The three added since are the terminal header's:
 *
 * - Warp and VS Code only when the mapped path yields a url at all (see projectLinks),
 *   which is the one thing that can silently be wrong about a projects.json entry.
 * - "New ticket" on every mapped project unconditionally: a repo can always take one,
 *   and the sheet's Project field only accepts a name /api/projects offers — which is
 *   exactly the set that has a stack row here.
 *
 * "Deploy with Claude" (`claude-deploy`) is unconditional for the same reason, and is
 * the one action here that asks before it fires — a production deploy is not something
 * to lose to a mistap on a crowded row. The confirm lives in the component, next to the
 * other two `confirm()` calls in the app; this list only says the button is offered.
 *
 * `canDeploy` mirrors MOJITO_SELF_UPDATE (see useSelfUpdate.enabled): with the endpoint
 * off, nothing should render the control.
 */
export function projectActions(stack: StackRow | null, canDeploy: boolean): ProjectAction[] {
  if (!stack) return [];
  const actions: ProjectAction[] = [];
  const links = projectLinks(stack);
  if (links.warp) actions.push("warp");
  if (links.vscode) actions.push("vscode");
  actions.push("ticket");
  if (stack.hasStack) {
    if (stack.status !== "running") actions.push("start");
    actions.push("stop", "logs");
  }
  if (stack.pullable) actions.push("pull");
  if (stack.self && canDeploy) actions.push("deploy");
  actions.push("push", "claude-deploy");
  if (!stack.hasWorktreeScript) actions.push("init-script");
  return actions;
}

/**
 * The project's "open this directory elsewhere" links, or "" each when there is none.
 *
 * The same pair the terminal header carries, pointed at the repo root rather than at a
 * session's cwd — so a project with no session open is still one tap from an editor.
 * Both are "" for a section with no mapped repo, and for a projects.json entry whose
 * path is not absolute: openInApp refuses to build a url that would resolve against
 * whatever directory the receiving app considers current.
 */
export function projectLinks(stack: StackRow | null): { warp: string; vscode: string } {
  const path = stack?.path ?? "";
  return { warp: warpUrl(path), vscode: vscodeUrl(path) };
}
