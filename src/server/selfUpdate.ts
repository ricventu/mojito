import { ffPull, type FfPullResult } from "./ffPull.js";

export type SelfUpdateResult = FfPullResult;

export function isSelfUpdateEnabled(): boolean {
  return process.env.MOJITO_SELF_UPDATE === "1";
}

// Module-level single-flight: a second POST while a pull is running gets the same
// promise, so there is never a parallel pull in the one server checkout.
let inflight: Promise<SelfUpdateResult> | null = null;

export function runSelfUpdate(
  pull: () => Promise<FfPullResult> = () => ffPull(process.cwd()),
): Promise<SelfUpdateResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      return await pull();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetSelfUpdate(): void {
  inflight = null;
}
