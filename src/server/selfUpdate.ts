import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ffPull, type FfPullResult } from "./ffPull";

const pexec = promisify(execFile);

export type SelfUpdateResult = FfPullResult;

export function isSelfUpdateEnabled(): boolean {
  return process.env.MOJITO_SELF_UPDATE === "1";
}

// Where scripts/prod-supervisor.mjs records itself, in the repo root it serves from.
export function supervisorPidPath(root: string): string {
  return join(root, ".prod-supervisor.pid");
}

type Kill = (pid: number, signal: NodeJS.Signals | 0) => void;

/**
 * macOS deploy trigger: nudge the prod supervisor (`make prod` or the LaunchAgent), which already owns the same
 * typecheck -> stop -> build -> start cycle the systemd unit runs on Linux.
 *
 * SIGUSR2, not SIGHUP: Node's default SIGHUP action is to exit, so handling it would turn
 * a terminal hangup into a rebuild and leave the supervisor orphaned.
 *
 * A missing, unparsable, or stale pid file throws instead of returning: the button must
 * never report a deploy that nothing is going to run.
 */
export async function signalProdSupervisor(
  root: string = process.cwd(),
  kill: Kill = (pid, signal) => process.kill(pid, signal),
): Promise<void> {
  const path = supervisorPidPath(root);
  let pid: number;
  try {
    pid = Number.parseInt(await readFile(path, "utf8"), 10);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("not a pid");
    kill(pid, 0); // liveness probe: a file left behind by a killed supervisor is not a listener
  } catch (e) {
    throw new Error(
      `no prod supervisor is listening on ${path} — this server was started outside \`make prod\` and the LaunchAgent (${String(e)})`,
    );
  }
  kill(pid, "SIGUSR2");
}

type Exec = (file: string, args: string[]) => Promise<unknown>;
const exec: Exec = (file, args) => pexec(file, args);

// The unit `make deploy` runs in on Linux. A transient unit of its own, not a child of
// the server: the deploy restarts mojito.service, and systemd would kill a child of that
// service halfway through. Created per deploy by systemd-run (`--collect` removes it,
// failed or not), so the server needs no hand-installed unit file that can go missing.
export const DEPLOY_UNIT = "mojito-deploy";

/**
 * Linux deploy trigger: `make deploy` (pnpm install -> build -> restart -> health) in
 * DEPLOY_UNIT. A deploy already running absorbs the request, as the Mac supervisor's
 * triggerRebuild() does — systemd-run would refuse a second unit of the same name.
 * `is-active` exits non-zero for a unit that is not running, so a rejection there means
 * "start one"; a failure of systemd-run itself propagates, and the button reports it.
 */
export async function startDeployUnit(root: string = process.cwd(), run: Exec = exec): Promise<void> {
  try {
    await run("systemctl", ["--user", "is-active", "--quiet", `${DEPLOY_UNIT}.service`]);
    return;
  } catch {
    // not running
  }
  await run("systemd-run", [
    "--user",
    `--unit=${DEPLOY_UNIT}`,
    "--collect",
    `--working-directory=${root}`,
    "--description=Mojito deploy (Pull & deploy)",
    "make",
    "deploy",
  ]);
}

// Start the rebuild+restart without blocking, so this request can return its
// response before the server it triggers is torn down: on Linux the transient deploy
// unit above, on the Mac the prod supervisor's SIGUSR2 cycle.
export async function triggerDeploy(): Promise<void> {
  if (process.platform === "darwin") return signalProdSupervisor();
  await startDeployUnit();
}

// Module-level single-flight: a second POST while a pull is running gets the same
// promise, so there is never a parallel pull in the one server checkout.
let inflight: Promise<SelfUpdateResult> | null = null;

export function runSelfUpdate(
  pull: () => Promise<FfPullResult> = () => ffPull(process.cwd()),
  deploy: () => Promise<void> = triggerDeploy,
): Promise<SelfUpdateResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await pull();
      // Unconditionally, whatever the pull did: "Pull & deploy" must always rebuild and
      // restart. Nothing else will: neither checkout has a post-merge hook, and the Mac's
      // prod supervisor watches no files, so a pull that brings commits produces no
      // rebuild of its own. A second click while a deploy runs costs nothing —
      // startDeployUnit() leaves a running unit alone, and the supervisor's
      // triggerRebuild() coalesces a second SIGUSR2 into at most one extra cycle.
      await deploy();
      return res;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetSelfUpdate(): void {
  inflight = null;
}
