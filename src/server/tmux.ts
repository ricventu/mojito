import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await pexec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(name: string, cwd: string, command: string): Promise<void> {
  await pexec("tmux", ["new-session", "-d", "-s", name, "-c", cwd, command]);
}

export async function pipePane(name: string, logfile: string): Promise<void> {
  await pexec("tmux", ["pipe-pane", "-t", name, "-o", `cat >> '${logfile.replace(/'/g, "'\\''")}'`]);
}

export async function killSession(name: string): Promise<void> {
  try {
    await pexec("tmux", ["kill-session", "-t", name]);
  } catch {
    /* already gone */
  }
}

export async function listSessions(prefix: string): Promise<string[]> {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function capturePane(name: string, lines: number): Promise<string> {
  const { stdout } = await pexec("tmux", ["capture-pane", "-t", name, "-p", "-S", `-${lines}`]);
  return stdout;
}
