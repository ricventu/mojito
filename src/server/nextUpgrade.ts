import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Keeping Mojito's WebSockets away from Next's own upgrade handling.
 *
 * The first time Next's request handler sees a request it attaches an `upgrade`
 * listener of its own to the http server, which it takes straight off
 * `req.socket.server` — `setupWebSocketHandler` in `next/dist/server/next.js`, a
 * one-shot guarded by its `didWebSocketSetup` flag. Node then runs *every* upgrade
 * listener: ours completes the handshake, Next's runs a moment later and, for a path
 * its router matches, calls `socket.end()`:
 *
 *     // TODO: allow upgrade requests to pages/app paths?
 *     if (matchedOutput) { return socket.end() }
 *     // If there's no matched output, we don't handle the request as user's
 *     // custom WS server may be listening on the same path.
 *
 * That carve-out is what used to save us: with routes `/` and `/api/*` only, nothing
 * matched `/ws/pty`, so Next left it alone. The optional catch-all `[[...view]]`
 * matches every path there is (RIC-204) — so `/ws/pty` and `/ws/events` started
 * matching, and every socket was ended ~10ms after it opened. Terminals came up black
 * and never recovered, and the client's 1.5s reconnect loop turned it into a pty leak
 * (see ptyGateway).
 *
 * Mojito routes `/_next` upgrades to Next itself, so its listener is pure harm here.
 */
/** Just the two members used here, so a plain EventEmitter stands in under test. */
type UpgradeEmitter = Pick<Server, "listeners" | "removeListener">;

/**
 * Mark Next's one-shot websocket setup as done before it can run for real, so it
 * never attaches a listener at all. Called with no server and no request, it takes
 * the `if (customServer)` branch nowhere and only flips its flag.
 *
 * Returns false when the internal is gone (a Next upgrade renamed it), which is what
 * `dropForeignUpgradeListeners` is there to catch.
 */
export function claimUpgrades(app: unknown): boolean {
  const setup = (app as { setupWebSocketHandler?: unknown } | null)?.setupWebSocketHandler;
  if (typeof setup !== "function") return false;
  (setup as (customServer?: unknown, req?: unknown) => void).call(app);
  return true;
}

/** What an upgrade listener is handed, named once so the two shapes below agree. */
type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * The handler to give Next its *own* upgrades — the `/_next` sockets Mojito routes
 * back to it, Fast Refresh's among them.
 *
 * Not `app.getUpgradeHandler()`, which is the public method and the wrong one: on
 * `NextCustomServer` — the class `next()` hands back, dev and prod alike — it reads
 * `this.server.getUpgradeHandler()`, i.e. the *inner* NextNodeServer, whose
 * `handleUpgrade` is a documented no-op ("the web server does not support web sockets,
 * it's only used for HMR in development"). So every socket handed to it is simply
 * dropped, and in dev the browser's HMR client retries forever.
 * Next's own `setupWebSocketHandler` — the listener `claimUpgrades` suppresses — does
 * not use that method either: it calls the `upgradeHandler` *getter*, which is the
 * router server's handler, the only one that answers `/_next/hmr`. So that is what we
 * take, falling back to the public method when it is gone.
 *
 * This was already broken before Next 16 and cost Fast Refresh silently: the getter
 * and the method have disagreed since at least Next 15, and the path also moved
 * (`/_next/webpack-hmr` → `/_next/hmr`), so nothing pointed at it. Both are inside
 * `/_next`, which is what `server.ts` routes on, so the rename needed no change there.
 */
export function nextUpgradeHandler(app: {
  getUpgradeHandler(): UpgradeHandler;
}): UpgradeHandler {
  const internal = (app as { upgradeHandler?: unknown }).upgradeHandler;
  if (typeof internal === "function") return internal.bind(app) as UpgradeHandler;
  return app.getUpgradeHandler();
}

/**
 * Remove every `upgrade` listener that is not ours. The fallback for the day the
 * internal above disappears: it costs one array read per upgrade, and loses only the
 * first socket after a foreign listener appeared — node copies the listener list
 * before emitting, so removing one mid-emit does not stop it running this time.
 */
export function dropForeignUpgradeListeners(server: UpgradeEmitter, ours: unknown): number {
  let dropped = 0;
  for (const listener of server.listeners("upgrade")) {
    if (listener === ours) continue;
    // `as never` rather than a cast to the listener signature: identity is all this
    // needs, and node's own overload is wider than anything we could name here.
    server.removeListener("upgrade", listener as never);
    dropped += 1;
  }
  return dropped;
}
