import { spawn as ptySpawn } from "node-pty";
import type { WebSocket } from "ws";
import { capturePane, hasSession } from "./tmux.js";
import { SESSION_GONE_CODE } from "../lib/ptyClose.js";

export interface AttachDeps {
  hasSession: (name: string) => Promise<boolean>;
  spawn: typeof ptySpawn;
  capturePane: (name: string, lines: number) => Promise<string>;
}

export function attachPty(ws: WebSocket, id: string, deps: Partial<AttachDeps> = {}): void {
  const d: AttachDeps = { hasSession, spawn: ptySpawn, capturePane, ...deps };

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

  let pty: ReturnType<typeof ptySpawn> | null = null;
  let cols = 80;
  let rows = 24;

  // Wire the message handler up front: the client sends a resize on open, which
  // can arrive before the async session check below resolves. Recording it into
  // cols/rows means the spawn picks up the right size. Keystrokes before the pty
  // exists are dropped — there is nothing to type into yet.
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      try {
        pty?.write(data.toString("utf8")); // keystrokes
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
        pty?.resize(cols, rows);
      }
    } catch {
      /* ignore malformed control frame */
    }
  });

  ws.on("close", () => {
    try {
      pty?.kill();
    } catch {
      /* already dead */
    }
  }); // detach this client only; tmux session survives

  // Never attach to a session that no longer exists. `tmux attach-session` would
  // otherwise spawn fine, print "can't find session: <id>" into the stream, and
  // exit — and the client, reconnecting every 1.5s, would repeat that error
  // forever (seen after a ticket auto-advances and the old status's session is
  // retired). Report it once with a distinct close code so the client stops.
  d.hasSession(id)
    .then((alive) => {
      if (!alive) {
        try {
          ws.send(`\r\nsession ${id} has ended\r\n`);
        } catch {
          /* socket closed */
        }
        ws.close(SESSION_GONE_CODE, "session gone");
        return;
      }

      try {
        pty = d.spawn("tmux", ["attach-session", "-t", id], {
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
      d.capturePane(id, 200)
        .then((s) => {
          try {
            ws.send(s);
          } catch {
            /* socket closed */
          }
        })
        .catch(() => {});

      pty.onData((chunk) => {
        try {
          ws.send(chunk);
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
    })
    .catch((err) => {
      // A failed existence check is treated as gone rather than spawning a doomed
      // attach — same no-retry signal so the client does not loop.
      console.error("session existence check failed:", err);
      ws.close(SESSION_GONE_CODE, "session gone");
    });
}
