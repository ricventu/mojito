import { createServer } from "node:http";
import next from "next";
import nextEnv from "@next/env";
import { WebSocketServer } from "ws";
import { getConfig, getRegistry, getBus } from "./src/server/app.js";
import { listSessions } from "./src/server/tmux.js";
import { tokenFromUrl } from "./src/server/auth.js";
import { attachPty } from "./src/server/ptyGateway.js";
import { attachEvents } from "./src/server/eventsWs.js";

// @next/env is CJS bundled via ncc, whose dynamically-defined named exports
// aren't visible to Node's cjs-module-lexer — import the default and
// destructure instead of `import { loadEnvConfig } from "@next/env"`.
const { loadEnvConfig } = nextEnv;

const dev = process.env.NODE_ENV !== "production";

// Custom servers bypass Next's CLI env loading, so load .env* files ourselves
// (same files/precedence Next would use: .env.local, .env.development, etc).
loadEnvConfig(process.cwd(), dev);

async function main() {
  const cfg = getConfig();
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Boot recovery: reconcile the registry with live tmux sessions.
  getRegistry().recover(await listSessions("mojito-"));

  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = req.url ?? "";
      if (!tokenFromUrl(url, cfg.token)) {
        socket.destroy();
        return;
      }
      const path = url.split("?")[0];
      if (path === "/ws/pty") {
        const id = new URLSearchParams(url.split("?")[1] ?? "").get("session") ?? "";
        if (!id) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => attachPty(ws, id));
      } else if (path === "/ws/events") {
        wss.handleUpgrade(req, socket, head, (ws) => attachEvents(ws, getBus()));
      } else {
        socket.destroy();
      }
    } catch (err) {
      console.error("upgrade handler error:", err);
      try {
        socket.destroy();
      } catch {
        /* already destroyed */
      }
    }
  });

  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Mojito on http://0.0.0.0:${cfg.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
