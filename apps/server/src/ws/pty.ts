/**
 * The browser terminal's gateway: one `tmux attach-session` inside a node-pty per socket.
 *
 * Wire protocol (`/ws/pty/<sessionId>?token=…`), unchanged from the old app's gateway:
 *
 * - client → server, **binary** frame: keystrokes, UTF-8, written to the pty as they are.
 * - client → server, **text** frame: a JSON control message. The only one is
 *   `{"resize":{"cols":<n>,"rows":<n>}}`; anything else, or malformed JSON, is ignored.
 * - server → client, **text** frames: terminal output. On attach the server first sends
 *   the pane's last 200 lines of scrollback (CRLF-normalized), then the live stream —
 *   live output that arrives meanwhile is held back so the replay never lands on top of it.
 * - close code `SESSION_GONE_CODE` (4404, from `@mojito/shared`): the tmux session does not
 *   exist. The client must NOT reconnect on it. Any other close is a candidate for retry.
 *
 * The resize frame is load-bearing. The pty is spawned at 80x24 unless a resize has
 * already arrived, and the client's resize is the only thing that ever corrects it — so
 * the client must send one on every (re)connect, unconditionally, even when it believes
 * the size has not changed (a socket reconnecting with the mobile keyboard up and the
 * resize skipped left the pane at 24 rows for good: RIC-258). Re-sending a size the pty
 * already has is a no-op.
 */
import { SESSION_GONE_CODE } from "@mojito/shared";
import { spawn as ptySpawn } from "node-pty";
import type { WebSocket } from "ws";
import { sanitizeEnv } from "../env/childEnv";
import { capturePane, hasSession, sessionTarget } from "../tmux/tmux";

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

  // Wired up front: the client sends a resize on open, which can arrive before the async
  // session check below resolves. Recording it into cols/rows means the spawn picks up the
  // right size. Keystrokes before the pty exists are dropped — there is nothing to type into.
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      try {
        pty?.write(data.toString("utf8"));
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
      // node-pty rejects a non-positive size. Swallowed silently this would leave the pty
      // at its previous geometry while the browser had already resized itself — a mismatch
      // that costs the TUI its bottom rows, input line included.
      console.error(`pty resize to ${cols}x${rows} failed:`, err);
    }
  });

  // Set by the close handler and read before the spawn: a socket can close while the
  // session check is still in flight, and the handler cannot kill a pty that does not exist yet.
  let socketClosed = false;

  // Detaches this client only; the tmux session survives.
  ws.on("close", () => {
    socketClosed = true;
    try {
      pty?.kill();
    } catch {
      /* already dead */
    }
  });

  // Never attach to a session that no longer exists: `tmux attach-session` would spawn fine,
  // print "can't find session" into the stream and exit, and the client's reconnect loop
  // would repeat that forever. Report it once with the close code that stops the client.
  d.hasSession(id)
    .then((alive) => {
      // The client is already gone: attaching now would spawn a `tmux attach-session` nobody
      // owns. Each such orphan holds one of the machine's ptys, and a client reconnecting
      // every 1.5s into this window exhausts them all within minutes.
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
        // Exact target: a bare `-t` prefix-matches, and would attach to `mj-RIC-49x` once
        // `mj-RIC-49` is gone (sessionTarget).
        pty = d.spawn("tmux", ["attach-session", "-t", sessionTarget(id)], {
          // tmux only emits sequences the client's terminfo names, and it hides the cursor
          // while it repaints. `xterm-color` has no civis/cnorm, so every cursor-hide was
          // dropped and the browser drew a cursor at random positions (RIC-241); it also
          // capped the palette at 8 colours. `xterm-256color` is what xterm.js is built to be.
          name: "xterm-256color",
          cols,
          rows,
          cwd: process.env.HOME,
          // Not process.env: Mojito's own NODE_ENV and credentials must not reach the
          // terminal the human is about to type into (childEnv.ts).
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

      // `tmux attach-session` repaints at once, so the async scrollback replay below races
      // it; unordered, the stale capture lands on top of live output and the terminal looks
      // garbled. Live output is buffered until the replay is flushed.
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

      // Recent scrollback first, so a reconnect is not blank. capture-pane emits bare LF;
      // xterm stair-steps each line from where the previous one ended unless it is CRLF.
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
      // A failed existence check is treated as gone rather than spawning a doomed attach.
      console.error("session existence check failed:", err);
      ws.close(SESSION_GONE_CODE, "session gone");
    });
}
