import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import next from "next";
import nextEnv from "@next/env";
import { WebSocketServer } from "ws";
import { getConfig, getRegistry, getBus } from "./src/server/app";
import { listSessions } from "./src/server/tmux";
import { adoptOrphanSessions } from "./src/server/adoptOrphans";
import { tokenFromUrl } from "./src/server/auth";
import { attachPty } from "./src/server/ptyGateway";
import { attachEvents } from "./src/server/eventsWs";
import { registerEnvFileKeys, registerEnvKeysAddedSince, snapshotEnvKeys } from "./src/server/childEnv";
import { startHeartbeat, markAlive } from "./src/server/heartbeat";
import { claimUpgrades, dropForeignUpgradeListeners, nextUpgradeHandler } from "./src/server/nextUpgrade";

// @next/env is CJS bundled via ncc, whose dynamically-defined named exports
// aren't visible to Node's cjs-module-lexer — import the default and
// destructure instead of `import { loadEnvConfig } from "@next/env"`.
const { loadEnvConfig } = nextEnv;

// Last-resort backstops: log and keep the server alive rather than crashing
// the whole process on an unforeseen async error (e.g. a stray ws message).
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

const dev = process.env.NODE_ENV !== "production";

// Custom servers bypass Next's CLI env loading, so load .env* files ourselves
// (same files/precedence Next would use: .env.local, .env.development, etc).
// Wrapped so the keys this pulls in — MOJITO_TOKEN, LINEAR_API_KEY, whatever .env.local
// grows next — are registered as Mojito's own and scrubbed from every spawned session
// rather than handed to it (RIC-207, childEnv.ts).
registerEnvFileKeys(() => loadEnvConfig(process.cwd(), dev));

async function main() {
  const cfg = getConfig();
  // Next writes to process.env as it boots, and none of it belongs to the repos Mojito's
  // sessions work in (RIC-246): `next()` sets TURBOPACK, which any other repo's `next`
  // reads as its bundler choice, and building the server sets NEXT_DEPLOYMENT_ID. Same
  // diff as the .env loader above, spanning statements because those two writes sit either
  // side of prepare()'s await. Must close before the first spawn — the tmux calls below.
  const beforeNext = snapshotEnvKeys();
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();
  registerEnvKeysAddedSince(beforeNext);
  // Must run after prepare() — Next throws otherwise. Not getUpgradeHandler(): in dev
  // that one resolves to a no-op and takes Fast Refresh with it (see nextUpgrade.ts).
  const upgradeHandle = nextUpgradeHandler(app);
  // Before the first request reaches Next: it would otherwise attach an `upgrade`
  // listener of its own and end the sockets this server has already upgraded, because
  // the page's optional catch-all route matches /ws/pty too. See nextUpgrade.ts.
  const claimed = claimUpgrades(app);

  // Boot recovery: reconcile the registry with live tmux sessions, both directions —
  // a registered session whose tmux died (recover) and a live tmux with no registration
  // at all (adopt: a Mojito process that died between spawning tmux and writing the
  // sidecar leaves exactly this — alive, but invisible until a boot like this one).
  const liveSessionNames = await listSessions("mojito-");
  getRegistry().recover(liveSessionNames);
  adoptOrphanSessions(getRegistry(), cfg.stateDir, cfg.projectsPath, liveSessionNames);

  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  // A WebSocket severed by an idle Tailscale/NAT timeout or a backgrounded mobile
  // browser emits no close event, so the terminal freezes and never reconnects.
  // Ping every client on an interval and reap the ones that stop ponging; the
  // ping traffic also keeps otherwise-idle connections from being dropped.
  const stopHeartbeat = startHeartbeat(wss);
  server.on("close", stopHeartbeat);

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // The fallback for a Next release that renames the internal claimUpgrades uses:
    // strip whatever attached itself behind our back, so at most the socket that
    // raced it is lost instead of every socket from here on.
    if (!claimed) {
      const dropped = dropForeignUpgradeListeners(server, onUpgrade);
      if (dropped) console.error(`dropped ${dropped} foreign upgrade listener(s) — see nextUpgrade.ts`);
    }
    try {
      const url = req.url ?? "";
      const path = url.split("?")[0];
      // Next's dev Fast Refresh connects over its own WebSocket (/_next/hmr — it was
      // /_next/webpack-hmr before Next 16; both sit under /_next, which is why the
      // rename costs nothing here). A custom server must hand Next's internal upgrade
      // requests back to Next, or HMR never connects and the browser stops
      // receiving hot updates while the server runs. These are Next-internal and
      // carry no Mojito token, so route them before the token gate. In production
      // (dev=false) there is no such socket, so this branch is inert.
      if (path.startsWith("/_next")) {
        upgradeHandle(req, socket, head);
        return;
      }
      if (!tokenFromUrl(url, cfg.token)) {
        socket.destroy();
        return;
      }
      if (path === "/ws/pty") {
        const id = new URLSearchParams(url.split("?")[1] ?? "").get("session") ?? "";
        if (!id) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => { markAlive(ws); attachPty(ws, id); });
      } else if (path === "/ws/events") {
        wss.handleUpgrade(req, socket, head, (ws) => { markAlive(ws); attachEvents(ws, getBus()); });
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
  };
  server.on("upgrade", onUpgrade);

  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`Mojito on http://0.0.0.0:${cfg.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
