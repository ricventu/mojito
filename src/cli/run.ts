import { parseCliArgs, type CliArgs } from "./args";
import { resolveProjectForPath, type GitPaths } from "./resolveProjectForPath";

/** The shape of `fetch` the CLI uses — narrow enough that a test can hand it a literal. */
export type CliFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface CliDeps {
  /** Named in the "no token" message, so the human knows which file to fix. */
  envFilePath: string;
  /** Only MOJITO_TOKEN and MOJITO_PORT are read; `process.env` satisfies it. */
  env: Record<string, string | undefined>;
  gitPaths: () => GitPaths;
  projects: () => { name: string; path: string }[];
  fetch: CliFetch;
  openUrl: (url: string, opts: { browserOnly: boolean }) => void;
  log: (line: string) => void;
}

export const DEFAULT_PORT = 4711;
const HEALTH_TIMEOUT_MS = 1500;

const USAGE = `mojito — open a Mojito session in the current directory

  mojito              a claude session in this folder's project (and worktree)
  mojito --shell      a plain terminal instead
  mojito --model <m>  model for the claude session (default opus)
  mojito --effort <e> low | medium | high | xhigh | max (default high)
  mojito --browser    the default browser instead of the installed Mojito app
  mojito --print      print the session url instead of opening anything
  mojito --help       this message`;

/**
 * The whole command, with every side effect injected. Sequence: parse, ask git, resolve
 * the project, check the server is up, launch, open the terminal.
 *
 * The health probe comes before the launch so that a stopped Mojito is reported as such
 * rather than as a fetch stack trace, and it is the reason a failure here costs no POST.
 */
export async function runMojitoCli(argv: string[], deps: CliDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    deps.log(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (args.help) {
    deps.log(USAGE);
    return 0;
  }

  const token = deps.env.MOJITO_TOKEN;
  if (!token) {
    deps.log(`no MOJITO_TOKEN — set it in ${deps.envFilePath}`);
    return 1;
  }
  const port = Number(deps.env.MOJITO_PORT ?? DEFAULT_PORT);
  // `localhost`, not `127.0.0.1`: the installed PWA's manifest scopes itself to
  // http://localhost:<port>/, and a deep link on any other origin is out of scope, so
  // macOS hands it to Safari instead of to the web app.
  const base = `http://localhost:${port}`;

  const git = deps.gitPaths();
  const { projectName, worktree } = resolveProjectForPath(git, deps.projects());

  if (!(await isHealthy(base, deps))) {
    deps.log(`Mojito is not running on port ${port} — start it with \`make prod\``);
    return 1;
  }

  if (!projectName) {
    // General is the home directory and ignores `worktree` outright (resolveScopedCwd), so
    // say where the session actually lands rather than implying it opens here.
    const here = git.toplevel ?? process.cwd();
    deps.log(`${here} is not a mapped project — opening a General session in ~`);
  }

  const body: Record<string, unknown> = args.kind === "shell"
    ? { kind: "shell", projectName }
    : { kind: "custom", projectName, model: args.model, effort: args.effort };
  // Only a real linked worktree of a mapped repo travels: the launch API reads anything
  // else as "no match" and falls back to the repo root with a warning.
  if (projectName && worktree) body.worktree = worktree;

  let res;
  try {
    res = await deps.fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mojito-token": token },
      body: JSON.stringify(body),
    });
  } catch (err) {
    deps.log(`launch failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const text = await res.text();
  if (!res.ok) {
    deps.log(`launch refused (${res.status}): ${text}`);
    return 1;
  }
  let id: string | undefined;
  try {
    id = (JSON.parse(text) as { id?: string }).id;
  } catch {
    id = undefined;
  }
  if (!id) {
    deps.log(`launch answered without a session id: ${text}`);
    return 1;
  }

  // The token rides in the query the way the phone link does — resolveInitialToken stores
  // it and strips it from the address bar. `--print` is the way to keep it out of a
  // browser history entry.
  const url = `${base}/session/${id}?token=${encodeURIComponent(token)}`;
  if (args.print) deps.log(url);
  else deps.openUrl(url, { browserOnly: args.browser });
  return 0;
}

async function isHealthy(base: string, deps: CliDeps): Promise<boolean> {
  try {
    const res = await deps.fetch(`${base}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}
