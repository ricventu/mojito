import { spawn as ptySpawn } from "node-pty";
import type { WebSocket } from "ws";
import { capturePane } from "./tmux.js";

export function attachPty(ws: WebSocket, id: string): void {
  let cols = 80;
  let rows = 24;
  // Replay recent scrollback before the live stream so a reconnect isn't blank.
  capturePane(id, 200).then((s) => ws.send(s)).catch(() => {});

  const pty = ptySpawn("tmux", ["attach-session", "-t", id], {
    name: "xterm-color",
    cols,
    rows,
    cwd: process.env.HOME,
    env: process.env as Record<string, string>,
  });

  pty.onData((d) => {
    try {
      ws.send(d);
    } catch {
      /* socket closed */
    }
  });
  pty.onExit(() => ws.close());

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      pty.write(data.toString("utf8")); // keystrokes
      return;
    }
    try {
      const msg = JSON.parse(data.toString("utf8"));
      if (msg.resize) {
        cols = msg.resize.cols;
        rows = msg.resize.rows;
        pty.resize(cols, rows);
      }
    } catch {
      /* ignore malformed control frame */
    }
  });

  ws.on("close", () => pty.kill()); // detach this client only; tmux session survives
}
