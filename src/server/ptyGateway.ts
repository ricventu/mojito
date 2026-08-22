import { spawn as ptySpawn } from "node-pty";
import type { WebSocket } from "ws";
import { capturePane, hasSession } from "./tmux";
import { sanitizeEnv } from "./childEnv";
import { SESSION_GONE_CODE } from "../lib/ptyClose";

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
    let msg: { resize?: { cols: number; rows: number } };
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return; /* ignore malformed control frame */
    }
    if (!msg.resize) return;
    cols = msg.resize.cols;
    rows = msg.resize.rows;
    try {
      pty?.resize(cols, rows);
    } catch (err) {
      // node-pty rejects a non-positive size. Swallowing this used to leave the
      // pty at its previous geometry while the browser had already resized
      // itself — a silent mismatch that costs the TUI its bottom rows (input
      // line included) with nothing to re-send the correct size.
      console.error(`pty resize to ${cols}x${rows} failed:`, err);
    }
  });

  // Set by the close handler below and read before the spawn: a socket can close
  // while the session check is still in flight, and the handler cannot kill a pty
  // that does not exist yet (see the guard in the .then()).
  let socketClosed = false;

  ws.on("close", () => {
    socketClosed = true;
    try {
      pty?.kill();
    } catch {
      /* already dead */
    }
  }); // detach this client only; tmux session survives

  // Never attach to a session that no longer exists. `tmux attach-session` would
  // otherwise spawn fine, print "can't find session: <id>" into the stream, and
  // exit — and the client, reconnecting every 1.5s, would repeat that error
  // forever (seen after a verdict launches the ticket's successor session and the
  // old status's session is retired). Report it once with a distinct close code so
  // the client stops.
  d.hasSession(id)
    .then((alive) => {
      // The client is already gone: attaching now would spawn a `tmux attach-session`
      // nobody owns — `ws.on("close")` has run, and it had no pty to kill. Every such
      // orphan holds one of the machine's ptys (macOS caps them at kern.tty.ptmx_max,
      // 511), and the client reconnects every 1.5s, so a socket that keeps closing in
      // this window exhausts the whole machine within minutes: no terminal anywhere
      // can open, and the server can no longer even fork `tmux has-session`.
      if (socketClosed) return;

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
          // tmux only ever emits a sequence the client's terminfo names, and it hides the
          // cursor while it repaints. `xterm-color` — what this spawned with from its first
          // commit — defines no `civis`/`cnorm` at all, so every cursor-hide claude's TUI
          // asked for was dropped here: the browser drew a cursor it had never been told to
          // hide, and tmux left it wherever its last cell run ended, which reads as a cursor
          // blinking at random positions all over the screen (RIC-241). Measured on one real
          // session and pane: 0 hide sequences reached the client under `xterm-color`, 20 in
          // three seconds under `xterm-256color`. Neither the renderer nor the number of
          // attached views is involved — which is why the symptom outlived both the DOM/WebGL
          // comparison and the single-view case. `xterm-256color` is also what xterm.js
          // itself is built to be: `xterm-color` capped the terminal at 8 colours, so tmux
          // was downsampling claude's palette on the way out too.
          name: "xterm-256color",
          cols,
          rows,
          cwd: process.env.HOME,
          // Not process.env: Mojito's own NODE_ENV/credentials must not reach the terminal
          // the human is about to type into either (childEnv.ts).
          env: sanitizeEnv(process.env),
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

      // The live attach stream and the async scrollback replay race: `tmux
      // attach-session` repaints immediately, so unordered the stale capture
      // lands *on top of* live output — the terminal looks garbled and frozen.
      // Buffer live output until the replay is flushed, then stream directly.
      let replayed = false;
      const buffered: string[] = [];
      pty.onData((chunk) => {
        if (!replayed) {
          buffered.push(chunk);
          return;
        }
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

      // Replay recent scrollback before the live stream so a reconnect isn't
      // blank. tmux capture-pane emits bare LF; convert to CRLF or xterm stair-
      // steps each line from where the previous one ended.
      d.capturePane(id, 200)
        .then((s) => {
          try {
            ws.send(s.replace(/\r?\n/g, "\r\n"));
          } catch {
            /* socket closed */
          }
        })
        .catch(() => {})
        .finally(() => {
          replayed = true;
          for (const chunk of buffered) {
            try {
              ws.send(chunk);
            } catch {
              /* socket closed */
            }
          }
          buffered.length = 0;
        });
    })
    .catch((err) => {
      // A failed existence check is treated as gone rather than spawning a doomed
      // attach — same no-retry signal so the client does not loop.
      console.error("session existence check failed:", err);
      ws.close(SESSION_GONE_CODE, "session gone");
    });
}
