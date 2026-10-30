import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "./http/setup";

// The wiring between the server and the built web client, over a real socket: what `pnpm
// start` serves is `createApp({ staticDir: apps/web/dist })`, so a fake dist stands in for it.
const INDEX = "<!doctype html><title>Mojito</title><div id=root></div>";

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mojito-static-"));
  writeFileSync(join(dir, "index.html"), INDEX);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  const { app } = setup({ staticDir: dir });
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  rmSync(dir, { recursive: true, force: true });
});

describe("static client", () => {
  it("serves index.html at /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toBe(INDEX);
  });

  it("serves index.html for a client-side route", async () => {
    const res = await fetch(`${base}/session/x`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toBe(INDEX);
  });

  it("serves a hashed asset as JavaScript", async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });

  it("keeps /api/health a JSON answer, not the client", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
