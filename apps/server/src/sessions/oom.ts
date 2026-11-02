import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { spawnEnv } from "../env/childEnv";

const pexec = promisify(execFile);

// A systemd unit name as it may be handed to journalctl: no leading `-` (it would read as an
// option), nothing but unit-name characters.
const SCOPE = /^[A-Za-z0-9][\w.:@-]*\.scope$/;

/**
 * The systemd scope a process runs in, from its cgroup (`0::/user.slice/…/tmux-spawn-<uuid>.scope`).
 * On Linux, tmux 3.4+ starts every pane in a scope of its own, and the scope is where the kernel's
 * OOM kills are recorded. Null anywhere else (no /proc on macOS, a process already gone, a cgroup
 * that is no scope).
 */
export function paneScope(pid: number, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string | null {
  let cgroup: string;
  try {
    cgroup = read(`/proc/${pid}/cgroup`);
  } catch {
    return null;
  }
  const line = cgroup.split("\n").find((l) => l.startsWith("0::"));
  const unit = line?.slice(3).trim().split("/").pop() ?? "";
  return SCOPE.test(unit) ? unit : null;
}

/** What systemd writes in a unit's journal when the kernel's OOM killer hit a process of it. */
export const OOM_LINE = /The kernel OOM killer killed some processes in this unit/;

/**
 * Whether the kernel's OOM killer hit `scope` at or after `sinceMs`, from the user journal (no
 * privileges needed: these are the user manager's own lines). Any failure — no journalctl, no
 * systemd, a timeout — answers false: the reason then stays what the hooks said.
 */
export async function oomKilledSince(scope: string, sinceMs: number): Promise<boolean> {
  if (!SCOPE.test(scope)) return false;
  try {
    const { stdout } = await pexec(
      "journalctl",
      ["--user", "-u", scope, "--since", `@${Math.floor(sinceMs / 1000)}`, "-o", "cat", "-q", "--no-pager"],
      { timeout: 5000, env: spawnEnv() },
    );
    return OOM_LINE.test(stdout);
  } catch {
    return false;
  }
}
