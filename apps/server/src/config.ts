import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { registerEnvFileKeys } from "./env/childEnv";

/** Another Mojito instance this one shows the sessions of (`MOJITO_PEERS`). */
export interface PeerConfig {
  /** The routing key in `/api/peers/:name` and the label every client shows. */
  name: string;
  /** Origin plus path, no trailing slash. */
  url: string;
}

export interface ServerConfig {
  /** This instance's name in the instance switcher (`MOJITO_NAME`). */
  name: string;
  peers: PeerConfig[];
  port: number;
  host: string;
  token: string;
  linearApiKey: string;
  stateDir: string;
  repoRoot: string;
  projectsJsonPath: string;
  home: string;
}

// The repository root, two levels above apps/server. Resolved from this module's own
// location rather than the cwd, so it is the same whether the server runs from src/ (tsx)
// or from the bundled dist/ — both sit one level below apps/server. Exported on its own
// because it is needed before `loadConfig` can run: `.env.local`, which usually carries
// the token `loadConfig` requires, is found there.
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");

/**
 * Port and host: `MOJITO_PORT` (default 8700) and `MOJITO_HOST` (default 127.0.0.1 — loopback:
 * the Linux box has a public address, and the phone reaches Mojito through Tailscale Serve,
 * never directly).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, osHostname: string = hostname()): ServerConfig {
  const token = env.MOJITO_TOKEN;
  if (!token) throw new Error("MOJITO_TOKEN is required");
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) throw new Error("LINEAR_API_KEY is required");
  const home = env.HOME ?? homedir();
  return {
    name: env.MOJITO_NAME || osHostname.split(".")[0],
    peers: parsePeers(env.MOJITO_PEERS),
    port: Number(env.MOJITO_PORT || 8700),
    host: env.MOJITO_HOST || "127.0.0.1",
    token,
    linearApiKey,
    stateDir: env.MOJITO_STATE_DIR ?? join(home, ".local", "state", "mojito"),
    repoRoot: REPO_ROOT,
    projectsJsonPath: env.MOJITO_PROJECTS ?? join(home, ".config", "mojito", "projects.json"),
    home,
  };
}

/**
 * `MOJITO_PEERS`: comma-separated http(s) URLs of the other instances. A peer is named by the
 * first DNS label of its host (`https://mac.<tailnet>.ts.net` → `mac`) — known at boot, with no
 * request — or by the whole hostname when that is an IP or has no dot (the dev setup's
 * `http://127.0.0.1:3200`). A bad URL or two peers with one name is a config error.
 */
export function parsePeers(raw: string | undefined): PeerConfig[] {
  const peers: PeerConfig[] = [];
  for (const item of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error(`MOJITO_PEERS: not an http(s) URL: ${item}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`MOJITO_PEERS: not an http(s) URL: ${item}`);
    const host = url.hostname;
    const name = isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") ? host : host.split(".")[0];
    if (peers.some((p) => p.name === name)) throw new Error(`MOJITO_PEERS: duplicate peer name: ${name}`);
    peers.push({ name, url: (url.origin + url.pathname).replace(/\/+$/, "") });
  }
  return peers;
}

/**
 * The origin Mojito's own children (the hook curls) reach the server at. A wildcard bind
 * (`0.0.0.0`, `::`) listens on loopback too, so that is used; any other host is the only
 * address the server answers on, so it is used as configured — a hard-coded 127.0.0.1 never
 * reached a server bound to, say, a Tailscale address.
 */
export function selfOrigin(cfg: Pick<ServerConfig, "host" | "port">): string {
  const host = cfg.host === "0.0.0.0" || cfg.host === "::" || cfg.host === "" ? "127.0.0.1" : cfg.host;
  return `http://${host.includes(":") ? `[${host}]` : host}:${cfg.port}`;
}

/**
 * Loads a dotenv file into `process.env`: a key already set in the environment wins over
 * the file. Whatever the file adds is registered with `registerEnvFileKeys`, so a credential
 * added to `.env.local` later is scrubbed from every child's environment without anyone
 * updating a list. A missing file is not an error.
 */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  registerEnvFileKeys(() => {
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  });
}
