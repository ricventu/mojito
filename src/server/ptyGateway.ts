import { spawn as ptySpawn } from "node-pty";
import type { WebSocket } from "ws";
import { capturePane } from "./tmux.js";

export function attachPty(ws: WebSocket, id: string): void {
  ws.on("error", (err) => {
    console.error("pty ws error:", err);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  });

  if (!id) {
    ws.close(1008, "missing session");
    return;
  }

  let cols = 80;
  let rows = 24;

  let pty;
  try {
    pty = ptySpawn("tmux", ["attach-session", "-t", id], {
      name: "xterm-color",
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env as Record<string, string>,
    });
  } catch (err) {
    console.error("failed to attach pty:", err);
    try {
      ws.send(`\r\nfailed to attach to session ${id}\r\n`);
    } catch {
      /* socket closed */
    }
    ws.close(1011, "pty spawn failed");
    return;
  }

  // Replay recent scrollback before the live stream so a reconnect isn't blank.
  capturePane(id, 200).then((s) => {
    try {
      ws.send(s);
    } catch {
      /* socket closed */
    }
  }).catch(() => {});

  pty.onData((d) => {
    try {
      ws.send(d);
    } catch {
      /* socket closed */
    }
  });
  pty.onExit(() => {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  });

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      try {
        pty.write(data.toString("utf8")); // keystrokes
      } catch (err) {
        console.error("pty write failed:", err);
      }
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

  ws.on("close", () => {
    try {
      pty.kill();
    } catch {
      /* already dead */
    }
  }); // detach this client only; tmux session survives
}
