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
 * macOS deploy trigger: nudge the `make prod` supervisor, which already owns the same
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
      `no prod supervisor is listening on ${path} — this server was started outside \`make prod\` (${String(e)})`,
    );
  }
  kill(pid, "SIGUSR2");
}

// Start the rebuild+restart without blocking, so this request can return its
// response before the server it triggers is torn down. On Linux that is the SAME
// systemd unit (stop -> npm ci -> build -> start) the post-merge git hook starts on a
// real merge; on the Mac it is the prod supervisor, which its own fs watcher would
// have driven had the pull brought commits.
export async function triggerDeploy(): Promise<void> {
  if (process.platform === "darwin") return signalProdSupervisor();
  await pexec("systemctl", ["--user", "start", "--no-block", "mojito-deploy.service"]);
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
      // A real merge fires the post-merge git hook, which runs the deploy. When
      // already up to date no merge happens and no hook fires — so trigger the
      // deploy explicitly. "Pull & deploy" must always rebuild and restart, even
      // when there is nothing new to pull.
      if (res.status === "up-to-date") await deploy();
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
