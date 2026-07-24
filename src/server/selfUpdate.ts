import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffPull, type FfPullResult } from "./ffPull.js";

const pexec = promisify(execFile);

export type SelfUpdateResult = FfPullResult;

export function isSelfUpdateEnabled(): boolean {
  return process.env.MOJITO_SELF_UPDATE === "1";
}

// Start the deploy unit (stop -> npm ci -> build -> start) without blocking, so
// this request can return its response before the server it triggers is torn
// down. This is the SAME unit the post-merge git hook starts on a real merge.
export async function triggerDeploy(): Promise<void> {
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
