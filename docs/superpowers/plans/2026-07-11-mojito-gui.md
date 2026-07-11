# Mojito GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first web app that lists non-closed Linear tickets, launches `claude "/lime-next <TICKET>"` stages in server-side tmux sessions, attaches an in-browser xterm terminal to any session, and alerts in-app when a session needs input or a stage finishes.

**Architecture:** A single custom Node server wraps Next.js (App Router) + a `ws` WebSocket server + a tmux control layer + a hook-driven monitor. tmux is the durable session store: each lime stage is one detached tmux session keyed by `(ticket + status)`. Detection is driven by Claude Code hooks (`PermissionRequest`/`Notification`/`Stop`/`SessionEnd`) that POST to a localhost-only sink — no idle timers. The browser attaches on demand via node-pty running `tmux attach`.

**Tech Stack:** Next.js (App Router, TypeScript), custom `server.ts` run with `tsx`, `ws`, `node-pty`, `tmux`, `xterm.js` (+ fit addon), shadcn/ui + Tailwind, Linear GraphQL over `fetch`, `vitest` for tests.

## Global Constraints

- **Language:** all code, comments, identifiers, commit messages in English.
- **Runtime:** LAN-reachable, single user. Server binds `0.0.0.0`. Every REST + WS request requires the `MOJITO_TOKEN` shared secret. `/api/hook` accepts connections from `127.0.0.1` only.
- **Secrets server-side only:** `LINEAR_API_KEY` and `MOJITO_TOKEN` never reach the client bundle (no `NEXT_PUBLIC_` prefix). The token is entered by the user in the PWA and stored in `localStorage`.
- **Model/effort defaults:** `--model opus`, `--effort high`. Model aliases: `opus|sonnet|fable` or full id. Effort: `low|medium|high|xhigh|max`.
- **Session identity:** the tmux session name IS the id. Name = `mojito-<TICKET>-<status-slug>`. tmux names must not contain `.`, `:`, or whitespace.
- **Terminal state (spec §Session lifecycle):** on `done`, tmux session stays alive until the user dismisses it. Never kill a session on WS disconnect.
- **No idle detection.** Detection is hook-based only.
- **Prerequisites on the host:** `tmux`, the `claude` CLI (≥ 2.1.205, with `--model`/`--effort`/`--settings` flags) on PATH, Node ≥ 20, and native build tools for `node-pty` (Python 3 + a C++ toolchain).

---

## File Structure

```
server.ts                          # custom server: Next + ws upgrade routing + boot recovery
src/server/
  config.ts                        # env-derived config (port, token, linear key, state dir, projects path)
  types.ts                         # shared types: SessionState, SessionMeta, HookEventName, etc.
  sessionKey.ts                    # pure: statusSlug, tmuxName, parseIdentifier, validateTicket
  hookSettings.ts                  # pure: build the --settings JSON with hook curl commands
  hookMap.ts                       # pure: map (hook event, statusAdvanced) -> state + alert
  autoAdvance.ts                   # pure: decide stop | gate | launch
  limeProjects.ts                  # read ~/.claude/lime-projects.json, resolveRepo
  worktree.ts                      # parse `git worktree list --porcelain`, resolveWorktree
  linear.ts                        # Linear GraphQL client: listOpenIssues, getIssueStatus
  sidecar.ts                       # read/write per-session metadata files
  tmux.ts                          # tmux control: has/new/pipePane/kill/list/capture
  registry.ts                      # in-memory session map + boot recovery
  launch.ts                        # orchestrate a launch (dedup, resolve cwd, spawn, sidecar)
  events.ts                        # event bus + WS broadcast
  auth.ts                          # token checks for REST + WS
  ptyGateway.ts                    # WS handler: node-pty tmux attach, bidirectional pipe
  hookHandler.ts                   # core logic for POST /api/hook (injectable deps)
src/app/
  layout.tsx                       # root layout, theme, PWA manifest link
  page.tsx                         # tab shell (Tickets | Sessions), token gate
  api/tickets/route.ts             # GET tickets
  api/sessions/route.ts            # GET list, POST launch
  api/sessions/[id]/route.ts       # DELETE dismiss/kill
  api/sessions/[id]/advance/route.ts # POST advance (gate verdict / merge mode)
  api/hook/route.ts                # POST hook sink (localhost-only)
src/components/
  TicketList.tsx  LaunchSheet.tsx  SessionList.tsx
  TerminalView.tsx  AccessoryBar.tsx  AlertLayer.tsx
src/lib/
  client.ts                        # fetch wrapper injecting the token
  useEvents.ts  useSessions.ts  useTickets.ts  useToken.ts
public/
  manifest.webmanifest  sw.js  alert.mp3
tests/                             # vitest specs mirror src/server paths
```

---

## Phase 0 — Scaffold

### Task 1: Initialize the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.env.example`, `.gitignore`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (placeholder)

**Interfaces:**
- Produces: a booting Next.js app and a runnable `vitest` command. No exported code symbols yet.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mojito-gui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "next build",
    "start": "cross-env NODE_ENV=production tsx server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ws": "^8.18.0",
    "node-pty": "^1.0.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "cross-env": "^7.0.3"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^19.0.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes; `node-pty` compiles (requires Python 3 + C++ toolchain). If it fails, install build tools first.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "incremental": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create config files**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`.gitignore`:
```
node_modules/
.next/
.env
.env.local
*.log
.mojito-state/
```

`.env.example`:
```
MOJITO_PORT=4711
MOJITO_TOKEN=change-me
LINEAR_API_KEY=lin_api_...
# optional overrides:
# LIME_PROJECTS=/Users/me/.claude/lime-projects.json
# MOJITO_STATE_DIR=/Users/me/.mojito-state
```

- [ ] **Step 5: Create minimal app files**

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
html, body { height: 100%; margin: 0; background: #0b0b0c; color: #e7e7ea; }
```

`src/app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Mojito" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main style={{ padding: 16 }}>Mojito booting…</main>;
}
```

- [ ] **Step 6: Verify the app boots and tests run**

Run: `npx next dev -p 4711` then open `http://localhost:4711`
Expected: page shows "Mojito booting…". Stop the server.
Run: `npm run test`
Expected: vitest runs and reports "No test files found" (acceptable at this point).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + tailwind + vitest"
```

---

### Task 2: Shared types + config module

**Files:**
- Create: `src/server/types.ts`, `src/server/config.ts`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Produces:
  - `type SessionState = 'starting' | 'running' | 'needs-input' | 'done' | 'failed'`
  - `type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `type HookEventName = 'PermissionRequest' | 'Notification' | 'Stop' | 'SessionEnd'`
  - `interface SessionMeta { id; ticket; launchStatus; model; effort; autoAdvance; state; cwd; createdAt; message? }`
  - `interface TicketSummary { identifier; title; statusName; statusType; project: string | null; labels: string[] }`
  - `interface AppConfig { port; token; linearApiKey; stateDir; projectsPath }`
  - `function loadConfig(env = process.env): AppConfig`

- [ ] **Step 1: Write the failing test**

`tests/server/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "@/server/config";

describe("loadConfig", () => {
  it("reads values from env with defaults", () => {
    const cfg = loadConfig({ MOJITO_TOKEN: "t", LINEAR_API_KEY: "k" } as NodeJS.ProcessEnv);
    expect(cfg.token).toBe("t");
    expect(cfg.linearApiKey).toBe("k");
    expect(cfg.port).toBe(4711);
    expect(cfg.stateDir).toMatch(/mojito-state$/);
  });

  it("throws when the token is missing", () => {
    expect(() => loadConfig({ LINEAR_API_KEY: "k" } as NodeJS.ProcessEnv)).toThrow(/MOJITO_TOKEN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL — cannot resolve `@/server/config`.

- [ ] **Step 3: Write the implementation**

`src/server/types.ts`:
```ts
export type SessionState = "starting" | "running" | "needs-input" | "done" | "failed";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type HookEventName = "PermissionRequest" | "Notification" | "Stop" | "SessionEnd";

export interface SessionMeta {
  id: string;            // tmux session name, e.g. "mojito-RIC-46-to-review"
  ticket: string;        // "RIC-46"
  launchStatus: string;  // Linear status name at launch, e.g. "Planned"
  model: string;         // "opus" | "sonnet" | "fable" | full id
  effort: Effort;
  autoAdvance: boolean;
  state: SessionState;
  cwd: string;
  createdAt: string;     // ISO
  message?: string;      // last alert message
}

export interface TicketSummary {
  identifier: string;
  title: string;
  statusName: string;
  statusType: string;    // triage | backlog | unstarted | started | completed | canceled
  project: string | null;
  labels: string[];
}

export interface AppConfig {
  port: number;
  token: string;
  linearApiKey: string;
  stateDir: string;
  projectsPath: string;
}
```

`src/server/config.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const token = env.MOJITO_TOKEN;
  if (!token) throw new Error("MOJITO_TOKEN is required");
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) throw new Error("LINEAR_API_KEY is required");
  return {
    port: Number(env.MOJITO_PORT ?? 4711),
    token,
    linearApiKey,
    stateDir: env.MOJITO_STATE_DIR ?? join(homedir(), ".mojito-state"),
    projectsPath: env.LIME_PROJECTS ?? join(homedir(), ".claude", "lime-projects.json"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/types.ts src/server/config.ts tests/server/config.test.ts
git commit -m "feat: add shared types and config loader"
```

---

## Phase 1 — Pure core logic (TDD)

### Task 3: Session key derivation

**Files:**
- Create: `src/server/sessionKey.ts`
- Test: `tests/server/sessionKey.test.ts`

**Interfaces:**
- Produces:
  - `function statusSlug(status: string): string`
  - `function tmuxName(ticket: string, status: string): string`
  - `function parseIdentifier(ticket: string): { teamKey: string; number: number }`
  - `function validateTicket(ticket: string): void` (throws on bad shape)

- [ ] **Step 1: Write the failing test**

`tests/server/sessionKey.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { statusSlug, tmuxName, parseIdentifier, validateTicket } from "@/server/sessionKey";

describe("sessionKey", () => {
  it("slugs a status", () => {
    expect(statusSlug("To Review")).toBe("to-review");
    expect(statusSlug("In Progress")).toBe("in-progress");
    expect(statusSlug("Backlog")).toBe("backlog");
  });

  it("builds a tmux-safe session name", () => {
    expect(tmuxName("RIC-46", "To Review")).toBe("mojito-RIC-46-to-review");
    expect(tmuxName("RIC-46", "To Review")).not.toMatch(/[.:\s]/);
  });

  it("parses an identifier", () => {
    expect(parseIdentifier("RIC-46")).toEqual({ teamKey: "RIC", number: 46 });
  });

  it("rejects a malformed ticket", () => {
    expect(() => validateTicket("nonsense")).toThrow();
    expect(() => validateTicket("RIC-46")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/sessionKey.ts`:
```ts
const TICKET_RE = /^([A-Z][A-Z0-9]*)-(\d+)$/;

export function validateTicket(ticket: string): void {
  if (!TICKET_RE.test(ticket)) throw new Error(`invalid ticket id: ${ticket}`);
}

export function parseIdentifier(ticket: string): { teamKey: string; number: number } {
  const m = TICKET_RE.exec(ticket);
  if (!m) throw new Error(`invalid ticket id: ${ticket}`);
  return { teamKey: m[1], number: Number(m[2]) };
}

export function statusSlug(status: string): string {
  return status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function tmuxName(ticket: string, status: string): string {
  validateTicket(ticket);
  return `mojito-${ticket}-${statusSlug(status)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/sessionKey.ts tests/server/sessionKey.test.ts
git commit -m "feat: add session key derivation"
```

---

### Task 4: Hook settings builder

**Files:**
- Create: `src/server/hookSettings.ts`
- Test: `tests/server/hookSettings.test.ts`

**Interfaces:**
- Produces: `function buildHookSettings(sessionId: string, port: number): { hooks: Record<string, unknown[]> }`
  - Emits one command hook per event in `PermissionRequest, Notification, Stop, SessionEnd`.
  - Each command POSTs the hook stdin to `http://127.0.0.1:<port>/api/hook?session=<id>&event=<event>` and always exits 0.

- [ ] **Step 1: Write the failing test**

`tests/server/hookSettings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildHookSettings } from "@/server/hookSettings";

describe("buildHookSettings", () => {
  const s = buildHookSettings("mojito-RIC-46-planned", 4711);

  it("defines all four hook events", () => {
    expect(Object.keys(s.hooks).sort()).toEqual(
      ["Notification", "PermissionRequest", "SessionEnd", "Stop"].sort(),
    );
  });

  it("each command targets the localhost sink with session and event", () => {
    const stop = JSON.stringify(s.hooks.Stop);
    expect(stop).toContain("127.0.0.1:4711/api/hook");
    expect(stop).toContain("session=mojito-RIC-46-planned");
    expect(stop).toContain("event=Stop");
    expect(stop).toContain("--data-binary @-"); // forwards hook stdin
    expect(stop).toContain("|| true");          // never blocks claude
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/hookSettings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/hookSettings.ts`:
```ts
import type { HookEventName } from "./types.js";

const EVENTS: HookEventName[] = ["PermissionRequest", "Notification", "Stop", "SessionEnd"];

function command(sessionId: string, port: number, event: HookEventName): string {
  const url = `http://127.0.0.1:${port}/api/hook?session=${encodeURIComponent(sessionId)}&event=${event}`;
  // -sS quiet, -m 2 hard timeout, forward stdin as the body, never fail the hook.
  return `curl -sS -m 2 -X POST "${url}" -H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true`;
}

export function buildHookSettings(sessionId: string, port: number): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: command(sessionId, port, event) }] }];
  }
  return { hooks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/hookSettings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/hookSettings.ts tests/server/hookSettings.test.ts
git commit -m "feat: build per-session claude hook settings"
```

---

### Task 5: Hook → state/alert mapping

**Files:**
- Create: `src/server/hookMap.ts`
- Test: `tests/server/hookMap.test.ts`

**Interfaces:**
- Produces:
  - `interface HookOutcome { state: SessionState; alert: { kind: "needs-input" | "stage-done" | "failed"; message: string } | null }`
  - `function mapHook(event: HookEventName, statusAdvanced: boolean): HookOutcome`

- [ ] **Step 1: Write the failing test**

`tests/server/hookMap.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapHook } from "@/server/hookMap";

describe("mapHook", () => {
  it("permission request needs input", () => {
    const o = mapHook("PermissionRequest", false);
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("stop with advanced status is done", () => {
    const o = mapHook("Stop", true);
    expect(o.state).toBe("done");
    expect(o.alert?.kind).toBe("stage-done");
  });

  it("stop with unchanged status means claude is waiting", () => {
    const o = mapHook("Stop", false);
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("session end without advance is a failure", () => {
    expect(mapHook("SessionEnd", false).state).toBe("failed");
    expect(mapHook("SessionEnd", true).state).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/hookMap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/hookMap.ts`:
```ts
import type { HookEventName, SessionState } from "./types.js";

export interface HookOutcome {
  state: SessionState;
  alert: { kind: "needs-input" | "stage-done" | "failed"; message: string } | null;
}

export function mapHook(event: HookEventName, statusAdvanced: boolean): HookOutcome {
  switch (event) {
    case "PermissionRequest":
      return { state: "needs-input", alert: { kind: "needs-input", message: "claude needs permission" } };
    case "Notification":
      return { state: "needs-input", alert: { kind: "needs-input", message: "claude needs your attention" } };
    case "Stop":
      return statusAdvanced
        ? { state: "done", alert: { kind: "stage-done", message: "stage complete" } }
        : { state: "needs-input", alert: { kind: "needs-input", message: "claude is waiting for you" } };
    case "SessionEnd":
      return statusAdvanced
        ? { state: "done", alert: { kind: "stage-done", message: "stage complete" } }
        : { state: "failed", alert: { kind: "failed", message: "session ended unexpectedly" } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/hookMap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/hookMap.ts tests/server/hookMap.test.ts
git commit -m "feat: map claude hooks to session state and alerts"
```

---

### Task 6: Auto-advance decision

**Files:**
- Create: `src/server/autoAdvance.ts`
- Test: `tests/server/autoAdvance.test.ts`

**Interfaces:**
- Produces:
  - `type AdvanceDecision = { action: "stop" } | { action: "gate"; gate: string } | { action: "launch" }`
  - `function decideAutoAdvance(newStatus: string, autoAdvance: boolean): AdvanceDecision`
  - `const GATE_STATES = ["To QA", "To Merge"]`, `const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"]`

- [ ] **Step 1: Write the failing test**

`tests/server/autoAdvance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decideAutoAdvance } from "@/server/autoAdvance";

describe("decideAutoAdvance", () => {
  it("stops when the toggle is off", () => {
    expect(decideAutoAdvance("In Progress", false)).toEqual({ action: "stop" });
  });
  it("stops at terminal states", () => {
    expect(decideAutoAdvance("Done", true)).toEqual({ action: "stop" });
  });
  it("gates at human-decision states", () => {
    expect(decideAutoAdvance("To QA", true)).toEqual({ action: "gate", gate: "To QA" });
    expect(decideAutoAdvance("To Merge", true)).toEqual({ action: "gate", gate: "To Merge" });
  });
  it("launches otherwise", () => {
    expect(decideAutoAdvance("Planned", true)).toEqual({ action: "launch" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/autoAdvance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/autoAdvance.ts`:
```ts
export type AdvanceDecision = { action: "stop" } | { action: "gate"; gate: string } | { action: "launch" };

export const GATE_STATES = ["To QA", "To Merge"];
export const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"];

export function decideAutoAdvance(newStatus: string, autoAdvance: boolean): AdvanceDecision {
  if (!autoAdvance) return { action: "stop" };
  if (TERMINAL_STATES.includes(newStatus)) return { action: "stop" };
  if (GATE_STATES.includes(newStatus)) return { action: "gate", gate: newStatus };
  return { action: "launch" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/autoAdvance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/autoAdvance.ts tests/server/autoAdvance.test.ts
git commit -m "feat: add auto-advance decision"
```

---

### Task 7: Lime project map resolution

**Files:**
- Create: `src/server/limeProjects.ts`
- Test: `tests/server/limeProjects.test.ts`

**Interfaces:**
- Consumes: `parseIdentifier` (Task 3).
- Produces:
  - `type ProjectMap = Record<string, string | { path: string; projects?: Record<string, string> }>`
  - `function resolveRepoFromMap(map: ProjectMap, teamKey: string, projectName: string | null): string | null`
  - `function loadProjectMap(path: string): ProjectMap` (returns `{}` if the file is missing)

- [ ] **Step 1: Write the failing test**

`tests/server/limeProjects.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveRepoFromMap } from "@/server/limeProjects";

describe("resolveRepoFromMap", () => {
  const map = {
    ENG: "/code/backend",
    WEB: { path: "/code/web", projects: { "Design System": "/code/ds" } },
  };
  it("resolves a string team entry", () => {
    expect(resolveRepoFromMap(map, "ENG", null)).toBe("/code/backend");
  });
  it("resolves the default path of an object entry", () => {
    expect(resolveRepoFromMap(map, "WEB", "Other")).toBe("/code/web");
  });
  it("resolves a project override", () => {
    expect(resolveRepoFromMap(map, "WEB", "Design System")).toBe("/code/ds");
  });
  it("returns null for an unknown team", () => {
    expect(resolveRepoFromMap(map, "NOPE", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/limeProjects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/limeProjects.ts`:
```ts
import { readFileSync } from "node:fs";

export type ProjectMap = Record<string, string | { path: string; projects?: Record<string, string> }>;

export function loadProjectMap(path: string): ProjectMap {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectMap;
  } catch {
    return {};
  }
}

export function resolveRepoFromMap(
  map: ProjectMap,
  teamKey: string,
  projectName: string | null,
): string | null {
  const entry = map[teamKey];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  if (projectName && entry.projects && entry.projects[projectName]) return entry.projects[projectName];
  return entry.path ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/limeProjects.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/limeProjects.ts tests/server/limeProjects.test.ts
git commit -m "feat: resolve repo from lime project map"
```

---

### Task 8: Worktree resolution

**Files:**
- Create: `src/server/worktree.ts`
- Test: `tests/server/worktree.test.ts`

**Interfaces:**
- Produces:
  - `function parseWorktrees(porcelain: string): { path: string; branch: string }[]`
  - `function matchWorktree(worktrees: { path: string; branch: string }[], ticket: string): string | null`
  - `function resolveWorktree(repoPath: string, ticket: string, run?: (cmd: string, args: string[]) => string): string | null` (runs `git worktree list --porcelain`, defaults to real exec; returns null on error)

- [ ] **Step 1: Write the failing test**

`tests/server/worktree.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseWorktrees, matchWorktree } from "@/server/worktree";

const PORCELAIN = `worktree /code/lime
HEAD abc
branch refs/heads/main

worktree /code/lime-RIC-46
HEAD def
branch refs/heads/ric-46-add-thing
`;

describe("worktree parsing", () => {
  it("parses porcelain output", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(wts).toHaveLength(2);
    expect(wts[1]).toEqual({ path: "/code/lime-RIC-46", branch: "ric-46-add-thing" });
  });
  it("matches a worktree by ticket id (case-insensitive)", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(matchWorktree(wts, "RIC-46")).toBe("/code/lime-RIC-46");
    expect(matchWorktree(wts, "RIC-99")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/worktree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/worktree.ts`:
```ts
import { execFileSync } from "node:child_process";

export function parseWorktrees(porcelain: string): { path: string; branch: string }[] {
  const out: { path: string; branch: string }[] = [];
  let path = "";
  let branch = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace("refs/heads/", "").trim();
    else if (line.trim() === "" && path) {
      out.push({ path, branch });
      path = "";
      branch = "";
    }
  }
  if (path) out.push({ path, branch });
  return out;
}

export function matchWorktree(worktrees: { path: string; branch: string }[], ticket: string): string | null {
  const needle = ticket.toLowerCase();
  const hit = worktrees.find((w) => w.branch.toLowerCase().includes(needle));
  return hit ? hit.path : null;
}

export function resolveWorktree(
  repoPath: string,
  ticket: string,
  run: (cmd: string, args: string[]) => string = (cmd, args) =>
    execFileSync(cmd, args, { cwd: repoPath, encoding: "utf8" }),
): string | null {
  try {
    return matchWorktree(parseWorktrees(run("git", ["worktree", "list", "--porcelain"])), ticket);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/worktree.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/worktree.ts tests/server/worktree.test.ts
git commit -m "feat: resolve a ticket worktree from git"
```

---

## Phase 2 — Linear client

### Task 9: Linear GraphQL client

**Files:**
- Create: `src/server/linear.ts`
- Test: `tests/server/linear.test.ts`

**Interfaces:**
- Consumes: `parseIdentifier` (Task 3), `TicketSummary` (Task 2).
- Produces:
  - `function listOpenIssues(apiKey: string, fetchImpl?: typeof fetch): Promise<TicketSummary[]>`
  - `function getIssueStatus(apiKey: string, identifier: string, fetchImpl?: typeof fetch): Promise<string>` (returns the status name)
  - Internal `mapIssueNode(node): TicketSummary`.

- [ ] **Step 1: Write the failing test**

`tests/server/linear.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { listOpenIssues, getIssueStatus } from "@/server/linear";

function fakeFetch(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ data: payload }) })) as unknown as typeof fetch;
}

describe("linear client", () => {
  it("maps open issues", async () => {
    const f = fakeFetch({
      issues: {
        nodes: [
          {
            identifier: "RIC-46",
            title: "Do thing",
            state: { name: "To Review", type: "started" },
            project: { name: "Lime" },
            labels: { nodes: [{ name: "bug" }] },
          },
        ],
      },
    });
    const items = await listOpenIssues("k", f);
    expect(items[0]).toEqual({
      identifier: "RIC-46",
      title: "Do thing",
      statusName: "To Review",
      statusType: "started",
      project: "Lime",
      labels: ["bug"],
    });
  });

  it("returns a single issue status", async () => {
    const f = fakeFetch({ issues: { nodes: [{ state: { name: "Planned" } }] } });
    expect(await getIssueStatus("k", "RIC-46", f)).toBe("Planned");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/linear.ts`:
```ts
import { parseIdentifier } from "./sessionKey.js";
import type { TicketSummary } from "./types.js";

const ENDPOINT = "https://api.linear.app/graphql";

interface IssueNode {
  identifier?: string;
  title?: string;
  state?: { name?: string; type?: string };
  project?: { name?: string } | null;
  labels?: { nodes?: { name: string }[] };
}

async function query<T>(apiKey: string, body: object, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if ((json as { errors?: unknown }).errors) throw new Error("Linear GraphQL error");
  return json.data;
}

function mapIssueNode(node: IssueNode): TicketSummary {
  return {
    identifier: node.identifier ?? "",
    title: node.title ?? "",
    statusName: node.state?.name ?? "",
    statusType: node.state?.type ?? "",
    project: node.project?.name ?? null,
    labels: node.labels?.nodes?.map((l) => l.name) ?? [],
  };
}

export async function listOpenIssues(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TicketSummary[]> {
  const data = await query<{ issues: { nodes: IssueNode[] } }>(
    apiKey,
    {
      query: `query {
        issues(filter: {
          assignee: { isMe: { eq: true } },
          state: { type: { nin: ["completed", "canceled"] } }
        }, first: 100) {
          nodes { identifier title state { name type } project { name } labels { nodes { name } } }
        }
      }`,
    },
    fetchImpl,
  );
  return data.issues.nodes
    .map(mapIssueNode)
    .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.identifier.localeCompare(b.identifier));
}

export async function getIssueStatus(apiKey: string, identifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { state?: { name?: string } }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { state { name } }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const name = data.issues.nodes[0]?.state?.name;
  if (!name) throw new Error(`issue not found: ${identifier}`);
  return name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/linear.ts tests/server/linear.test.ts
git commit -m "feat: add Linear GraphQL client"
```

---

## Phase 3 — tmux, sidecar, registry, launch

### Task 10: Sidecar metadata store

**Files:**
- Create: `src/server/sidecar.ts`
- Test: `tests/server/sidecar.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` (Task 2).
- Produces:
  - `function writeSidecar(stateDir: string, meta: SessionMeta): void`
  - `function readSidecar(stateDir: string, id: string): SessionMeta | null`
  - `function listSidecars(stateDir: string): SessionMeta[]`
  - `function removeSidecar(stateDir: string, id: string): void`
  - `function logfilePath(stateDir: string, id: string): string`

- [ ] **Step 1: Write the failing test**

`tests/server/sidecar.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSidecar, readSidecar, listSidecars, removeSidecar } from "@/server/sidecar";
import type { SessionMeta } from "@/server/types";

const meta: SessionMeta = {
  id: "mojito-RIC-46-planned",
  ticket: "RIC-46",
  launchStatus: "Planned",
  model: "opus",
  effort: "high",
  autoAdvance: false,
  state: "running",
  cwd: "/code/lime",
  createdAt: "2026-07-11T00:00:00.000Z",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-"));
});

describe("sidecar", () => {
  it("round-trips a session", () => {
    writeSidecar(dir, meta);
    expect(readSidecar(dir, meta.id)).toEqual(meta);
  });
  it("lists and removes", () => {
    writeSidecar(dir, meta);
    expect(listSidecars(dir)).toHaveLength(1);
    removeSidecar(dir, meta.id);
    expect(listSidecars(dir)).toHaveLength(0);
  });
  it("returns null for a missing session", () => {
    expect(readSidecar(dir, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sidecar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/sidecar.ts`:
```ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SessionMeta } from "./types.js";

function sessionsDir(stateDir: string): string {
  const dir = join(stateDir, "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function logfilePath(stateDir: string, id: string): string {
  const dir = join(stateDir, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${id}.log`);
}

export function writeSidecar(stateDir: string, meta: SessionMeta): void {
  writeFileSync(join(sessionsDir(stateDir), `${meta.id}.json`), JSON.stringify(meta, null, 2));
}

export function readSidecar(stateDir: string, id: string): SessionMeta | null {
  try {
    return JSON.parse(readFileSync(join(sessionsDir(stateDir), `${id}.json`), "utf8")) as SessionMeta;
  } catch {
    return null;
  }
}

export function listSidecars(stateDir: string): SessionMeta[] {
  return readdirSync(sessionsDir(stateDir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readSidecar(stateDir, f.replace(/\.json$/, "")))
    .filter((m): m is SessionMeta => m !== null);
}

export function removeSidecar(stateDir: string, id: string): void {
  try {
    rmSync(join(sessionsDir(stateDir), `${id}.json`));
  } catch {
    /* already gone */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sidecar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/sidecar.ts tests/server/sidecar.test.ts
git commit -m "feat: add session sidecar metadata store"
```

---

### Task 11: tmux control module

**Files:**
- Create: `src/server/tmux.ts`
- Test: `tests/server/tmux.integration.test.ts`

**Interfaces:**
- Produces (all `Promise`-returning, backed by `execFile`):
  - `function hasSession(name: string): Promise<boolean>`
  - `function newSession(name: string, cwd: string, command: string): Promise<void>`
  - `function pipePane(name: string, logfile: string): Promise<void>`
  - `function killSession(name: string): Promise<void>`
  - `function listSessions(prefix: string): Promise<string[]>`
  - `function capturePane(name: string, lines: number): Promise<string>`
  - `function tmuxAvailable(): boolean`

- [ ] **Step 1: Write the failing integration test**

`tests/server/tmux.integration.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import * as tmux from "@/server/tmux";

const run = tmux.tmuxAvailable() ? describe : describe.skip;
const NAME = "mojito-test-ric-1-integration";

run("tmux control (requires tmux)", () => {
  afterAll(async () => {
    if (await tmux.hasSession(NAME)) await tmux.killSession(NAME);
  });

  it("creates, detects, lists, captures, and kills a session", async () => {
    await tmux.newSession(NAME, tmpdir(), "printf 'hello-mojito\\n'; sleep 30");
    expect(await tmux.hasSession(NAME)).toBe(true);
    expect(await tmux.listSessions("mojito-test-")).toContain(NAME);
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.capturePane(NAME, 50)).toContain("hello-mojito");
    await tmux.killSession(NAME);
    expect(await tmux.hasSession(NAME)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/tmux.integration.test.ts`
Expected: FAIL — module not found (or "skipped" only if tmux is absent; install tmux to run it).

- [ ] **Step 3: Write the implementation**

`src/server/tmux.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export function tmuxAvailable(): boolean {
  try {
    require("node:child_process").execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await pexec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(name: string, cwd: string, command: string): Promise<void> {
  await pexec("tmux", ["new-session", "-d", "-s", name, "-c", cwd, command]);
}

export async function pipePane(name: string, logfile: string): Promise<void> {
  await pexec("tmux", ["pipe-pane", "-t", name, "-o", `cat >> '${logfile.replace(/'/g, "'\\''")}'`]);
}

export async function killSession(name: string): Promise<void> {
  try {
    await pexec("tmux", ["kill-session", "-t", name]);
  } catch {
    /* already gone */
  }
}

export async function listSessions(prefix: string): Promise<string[]> {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function capturePane(name: string, lines: number): Promise<string> {
  const { stdout } = await pexec("tmux", ["capture-pane", "-t", name, "-p", "-S", `-${lines}`]);
  return stdout;
}
```

Note: `require` inside an ESM module works under `tsx`; if strict ESM complains, replace `tmuxAvailable` with an async probe using `pexec("tmux", ["-V"])`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/tmux.integration.test.ts`
Expected: PASS (1 test) when tmux is installed.

- [ ] **Step 5: Commit**

```bash
git add src/server/tmux.ts tests/server/tmux.integration.test.ts
git commit -m "feat: add tmux control module"
```

---

### Task 12: Session registry + boot recovery

**Files:**
- Create: `src/server/registry.ts`
- Test: `tests/server/registry.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` (Task 2), `listSidecars`/`readSidecar`/`writeSidecar`/`removeSidecar` (Task 10).
- Produces a `Registry` class:
  - `constructor(stateDir: string)`
  - `get(id): SessionMeta | undefined`
  - `all(): SessionMeta[]`
  - `upsert(meta: SessionMeta): void` (persists sidecar)
  - `patch(id, partial: Partial<SessionMeta>): SessionMeta | undefined` (persists)
  - `remove(id): void` (removes sidecar)
  - `recover(liveSessionNames: string[]): void` (loads sidecars; marks any whose tmux session is gone as `failed` unless already `done`)

- [ ] **Step 1: Write the failing test**

`tests/server/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@/server/registry";
import { writeSidecar } from "@/server/sidecar";
import type { SessionMeta } from "@/server/types";

function meta(id: string, state: SessionMeta["state"] = "running"): SessionMeta {
  return { id, ticket: "RIC-46", launchStatus: "Planned", model: "opus", effort: "high",
    autoAdvance: false, state, cwd: "/x", createdAt: "2026-07-11T00:00:00.000Z" };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("Registry", () => {
  it("upserts and patches with persistence", () => {
    const r = new Registry(dir);
    r.upsert(meta("a"));
    r.patch("a", { state: "needs-input", message: "hi" });
    expect(r.get("a")?.state).toBe("needs-input");
    expect(new Registry(dir).get("a")?.state).toBe("needs-input"); // reloaded from disk
  });

  it("recovers sidecars and fails dead running sessions", () => {
    writeSidecar(dir, meta("alive"));
    writeSidecar(dir, meta("dead"));
    writeSidecar(dir, meta("finished", "done"));
    const r = new Registry(dir);
    r.recover(["alive"]);
    expect(r.get("alive")?.state).toBe("running");
    expect(r.get("dead")?.state).toBe("failed");
    expect(r.get("finished")?.state).toBe("done"); // done stays done
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/registry.ts`:
```ts
import type { SessionMeta } from "./types.js";
import { listSidecars, readSidecar, writeSidecar, removeSidecar } from "./sidecar.js";

export class Registry {
  private map = new Map<string, SessionMeta>();
  constructor(private stateDir: string) {
    for (const m of listSidecars(stateDir)) this.map.set(m.id, m);
  }
  get(id: string): SessionMeta | undefined {
    return this.map.get(id);
  }
  all(): SessionMeta[] {
    return [...this.map.values()];
  }
  upsert(meta: SessionMeta): void {
    this.map.set(meta.id, meta);
    writeSidecar(this.stateDir, meta);
  }
  patch(id: string, partial: Partial<SessionMeta>): SessionMeta | undefined {
    const current = this.map.get(id) ?? readSidecar(this.stateDir, id) ?? undefined;
    if (!current) return undefined;
    const next = { ...current, ...partial };
    this.upsert(next);
    return next;
  }
  remove(id: string): void {
    this.map.delete(id);
    removeSidecar(this.stateDir, id);
  }
  recover(liveSessionNames: string[]): void {
    const live = new Set(liveSessionNames);
    for (const m of this.all()) {
      if (!live.has(m.id) && m.state !== "done") this.patch(m.id, { state: "failed" });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/registry.ts tests/server/registry.test.ts
git commit -m "feat: add session registry with boot recovery"
```

---

### Task 13: Launch orchestration

**Files:**
- Create: `src/server/launch.ts`
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `tmuxName` (Task 3), `buildHookSettings` (Task 4), `resolveRepoFromMap`/`loadProjectMap` (Task 7), `resolveWorktree` (Task 8), `parseIdentifier` (Task 3), `logfilePath` (Task 10), `Registry` (Task 12), tmux fns (Task 11).
- Produces:
  - `interface LaunchRequest { ticket: string; status: string; model: string; effort: Effort; autoAdvance: boolean; projectName: string | null }`
  - `interface LaunchDeps { registry; stateDir; port; projectsPath; hasSession; newSession; pipePane; resolveCwd?; nowIso? }`
  - `function buildClaudeCommand(req, settingsPath): string` — the exact shell command run in tmux
  - `async function launchSession(req: LaunchRequest, deps: LaunchDeps): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }>`
  - The generated `--settings` file is written to `<stateDir>/settings/<id>.json`.

- [ ] **Step 1: Write the failing test**

`tests/server/launch.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchSession, buildClaudeCommand } from "@/server/launch";
import { Registry } from "@/server/registry";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

const baseReq = {
  ticket: "RIC-46", status: "Planned", model: "opus", effort: "high" as const,
  autoAdvance: false, projectName: "Lime",
};

function deps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => "/code/lime",
    nowIso: () => "2026-07-11T00:00:00.000Z",
    ...over,
  };
}

describe("launchSession", () => {
  it("builds a claude command with model, effort, settings, and the slash command", () => {
    const cmd = buildClaudeCommand(baseReq, "/state/settings/x.json");
    expect(cmd).toContain("claude --model opus --effort high");
    expect(cmd).toContain("--settings '/state/settings/x.json'");
    expect(cmd).toContain('"/lime-next RIC-46"');
  });

  it("refuses a duplicate", async () => {
    const d = deps({ hasSession: vi.fn(async () => true) });
    const res = await launchSession(baseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "duplicate", id: "mojito-RIC-46-planned" });
  });

  it("refuses when no repo resolves", async () => {
    const d = deps({ resolveCwd: () => null });
    const res = await launchSession(baseReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("spawns tmux, pipes the pane, and registers the session", async () => {
    const d = deps();
    const res = await launchSession(baseReq, d);
    expect(res.ok).toBe(true);
    expect(d.newSession).toHaveBeenCalledOnce();
    expect(d.pipePane).toHaveBeenCalledOnce();
    expect(d.registry.get("mojito-RIC-46-planned")?.state).toBe("starting");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/launch.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Effort, SessionMeta } from "./types.js";
import { tmuxName, parseIdentifier, validateTicket } from "./sessionKey.js";
import { buildHookSettings } from "./hookSettings.js";
import { loadProjectMap, resolveRepoFromMap } from "./limeProjects.js";
import { resolveWorktree } from "./worktree.js";
import { logfilePath } from "./sidecar.js";
import type { Registry } from "./registry.js";

export interface LaunchRequest {
  ticket: string;
  status: string;
  model: string;
  effort: Effort;
  autoAdvance: boolean;
  projectName: string | null;
}

export interface LaunchDeps {
  registry: Registry;
  stateDir: string;
  port: number;
  projectsPath: string;
  hasSession: (name: string) => Promise<boolean>;
  newSession: (name: string, cwd: string, command: string) => Promise<void>;
  pipePane: (name: string, logfile: string) => Promise<void>;
  resolveCwd?: (ticket: string, projectName: string | null) => string | null;
  nowIso?: () => string;
}

function defaultResolveCwd(projectsPath: string) {
  return (ticket: string, projectName: string | null): string | null => {
    const { teamKey } = parseIdentifier(ticket);
    const repo = resolveRepoFromMap(loadProjectMap(projectsPath), teamKey, projectName);
    if (!repo) return null;
    return resolveWorktree(repo, ticket) ?? repo;
  };
}

export function buildClaudeCommand(req: LaunchRequest, settingsPath: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return (
    `claude --model ${req.model} --effort ${req.effort} ` +
    `--settings ${q(settingsPath)} "/lime-next ${req.ticket}"`
  );
}

export async function launchSession(
  req: LaunchRequest,
  deps: LaunchDeps,
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "duplicate" | "no-repo"; id?: string }> {
  validateTicket(req.ticket);
  const id = tmuxName(req.ticket, req.status);

  if (await deps.hasSession(id)) return { ok: false, reason: "duplicate", id };

  const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
  const cwd = resolveCwd(req.ticket, req.projectName);
  if (!cwd) return { ok: false, reason: "no-repo" };

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port), null, 2));

  const command = buildClaudeCommand(req, settingsPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const meta: SessionMeta = {
    id,
    ticket: req.ticket,
    launchStatus: req.status,
    model: req.model,
    effort: req.effort,
    autoAdvance: req.autoAdvance,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat: add launch orchestration with dedup and hook injection"
```

---

## Phase 4 — Events, auth, hook handler, API, WS

### Task 14: Event bus

**Files:**
- Create: `src/server/events.ts`
- Test: `tests/server/events.test.ts`

**Interfaces:**
- Produces:
  - `type MojitoEvent = { type: "session.state"; id: string; state: SessionState } | { type: "session.alert"; id: string; kind: string; ticket: string; message: string }`
  - `class EventBus { subscribe(fn: (e: MojitoEvent) => void): () => void; emit(e: MojitoEvent): void }`

- [ ] **Step 1: Write the failing test**

`tests/server/events.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@/server/events";

describe("EventBus", () => {
  it("delivers to subscribers and supports unsubscribe", () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.subscribe(spy);
    bus.emit({ type: "session.state", id: "a", state: "running" });
    expect(spy).toHaveBeenCalledOnce();
    off();
    bus.emit({ type: "session.state", id: "a", state: "done" });
    expect(spy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/events.ts`:
```ts
import type { SessionState } from "./types.js";

export type MojitoEvent =
  | { type: "session.state"; id: string; state: SessionState }
  | { type: "session.alert"; id: string; kind: string; ticket: string; message: string };

export class EventBus {
  private subs = new Set<(e: MojitoEvent) => void>();
  subscribe(fn: (e: MojitoEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(e: MojitoEvent): void {
    for (const fn of this.subs) fn(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/events.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/server/events.ts tests/server/events.test.ts
git commit -m "feat: add in-process event bus"
```

---

### Task 15: Auth helpers + app singleton

**Files:**
- Create: `src/server/auth.ts`, `src/server/app.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Produces:
  - `function tokenFromHeaders(headers: Headers, expected: string): boolean` (checks `x-mojito-token`)
  - `function tokenFromUrl(url: string, expected: string): boolean` (checks `?token=`)
  - `src/server/app.ts` exports lazily-built singletons: `config`, `registry`, `bus` — the shared server state used by API routes and the custom server.

- [ ] **Step 1: Write the failing test**

`tests/server/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokenFromHeaders, tokenFromUrl } from "@/server/auth";

describe("auth", () => {
  it("validates a header token", () => {
    expect(tokenFromHeaders(new Headers({ "x-mojito-token": "s" }), "s")).toBe(true);
    expect(tokenFromHeaders(new Headers({ "x-mojito-token": "x" }), "s")).toBe(false);
    expect(tokenFromHeaders(new Headers(), "s")).toBe(false);
  });
  it("validates a url token", () => {
    expect(tokenFromUrl("/ws/events?token=s", "s")).toBe(true);
    expect(tokenFromUrl("/ws/events?token=x", "s")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/auth.ts`:
```ts
export function tokenFromHeaders(headers: Headers, expected: string): boolean {
  return headers.get("x-mojito-token") === expected;
}

export function tokenFromUrl(url: string, expected: string): boolean {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("token") === expected;
}
```

`src/server/app.ts`:
```ts
import { loadConfig } from "./config.js";
import { Registry } from "./registry.js";
import { EventBus } from "./events.js";
import type { AppConfig } from "./types.js";

let _config: AppConfig | undefined;
let _registry: Registry | undefined;
let _bus: EventBus | undefined;

export function getConfig(): AppConfig {
  return (_config ??= loadConfig());
}
export function getRegistry(): Registry {
  return (_registry ??= new Registry(getConfig().stateDir));
}
export function getBus(): EventBus {
  return (_bus ??= new EventBus());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth.ts src/server/app.ts tests/server/auth.test.ts
git commit -m "feat: add token auth helpers and shared app singletons"
```

---

### Task 16: Hook handler logic

**Files:**
- Create: `src/server/hookHandler.ts`
- Test: `tests/server/hookHandler.test.ts`

**Interfaces:**
- Consumes: `mapHook` (Task 5), `decideAutoAdvance` (Task 6), `Registry` (Task 12), `EventBus` (Task 14).
- Produces:
  - `interface HookDeps { registry; bus; getIssueStatus: (ticket: string) => Promise<string>; onAutoAdvance: (meta: SessionMeta, newStatus: string) => void }`
  - `async function handleHook(id: string, event: HookEventName, deps: HookDeps): Promise<void>`
  - Behavior: looks up the session; for `Stop`/`SessionEnd` fetches the current Linear status and compares to `launchStatus` to compute `statusAdvanced`; applies `mapHook`; patches state + emits `session.state` and (if any) `session.alert`; on `done` calls `decideAutoAdvance` and invokes `onAutoAdvance` when the decision is `launch`.

- [ ] **Step 1: Write the failing test**

`tests/server/hookHandler.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHook } from "@/server/hookHandler";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): { registry: Registry; meta: SessionMeta } {
  const registry = new Registry(dir);
  const meta: SessionMeta = { id: "mojito-RIC-46-planned", ticket: "RIC-46", launchStatus: "Planned",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", ...over };
  registry.upsert(meta);
  return { registry, meta };
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("handleHook", () => {
  it("permission request flips to needs-input and emits an alert", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-planned", "PermissionRequest", {
      registry, bus, getIssueStatus: async () => "Planned", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("needs-input");
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-planned", state: "needs-input" });
  });

  it("stop with advanced status marks done and triggers auto-advance when enabled", async () => {
    const { registry } = seed({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-planned", "Stop", {
      registry, bus, getIssueStatus: async () => "In Progress", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("done");
    expect(onAutoAdvance).toHaveBeenCalledWith(expect.objectContaining({ ticket: "RIC-46" }), "In Progress");
  });

  it("stop with unchanged status is needs-input (claude asked something)", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-planned", "Stop", {
      registry, bus, getIssueStatus: async () => "Planned", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("needs-input");
  });

  it("ignores an unknown session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("nope", "Stop", { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    // no throw, nothing emitted
    expect(registry.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/hookHandler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/server/hookHandler.ts`:
```ts
import type { HookEventName, SessionMeta } from "./types.js";
import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";
import { mapHook } from "./hookMap.js";
import { decideAutoAdvance } from "./autoAdvance.js";

export interface HookDeps {
  registry: Registry;
  bus: EventBus;
  getIssueStatus: (ticket: string) => Promise<string>;
  onAutoAdvance: (meta: SessionMeta, newStatus: string) => void;
}

export async function handleHook(id: string, event: HookEventName, deps: HookDeps): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta) return;

  let statusAdvanced = false;
  let newStatus = meta.launchStatus;
  if (event === "Stop" || event === "SessionEnd") {
    try {
      newStatus = await deps.getIssueStatus(meta.ticket);
      statusAdvanced = newStatus !== meta.launchStatus;
    } catch {
      statusAdvanced = false; // treat a fetch failure as "not advanced" → surfaces as needs-input
    }
  }

  const outcome = mapHook(event, statusAdvanced);
  const updated = deps.registry.patch(id, { state: outcome.state, message: outcome.alert?.message });
  deps.bus.emit({ type: "session.state", id, state: outcome.state });
  if (outcome.alert) {
    deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: meta.ticket, message: outcome.alert.message });
  }

  if (outcome.state === "done" && updated) {
    const decision = decideAutoAdvance(newStatus, updated.autoAdvance);
    if (decision.action === "launch") deps.onAutoAdvance(updated, newStatus);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/hookHandler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/hookHandler.ts tests/server/hookHandler.test.ts
git commit -m "feat: add hook handler with status disambiguation and auto-advance"
```

---

### Task 17: API routes

**Files:**
- Create: `src/app/api/tickets/route.ts`, `src/app/api/sessions/route.ts`, `src/app/api/sessions/[id]/route.ts`, `src/app/api/sessions/[id]/advance/route.ts`, `src/app/api/hook/route.ts`
- Create: `src/server/autoAdvanceRunner.ts` (wires a `done` → next-stage launch using `launchSession`)

**Interfaces:**
- Consumes: `getConfig`/`getRegistry`/`getBus` (Task 15), `listOpenIssues`/`getIssueStatus` (Task 9), `launchSession` (Task 13), `handleHook` (Task 16), tmux fns (Task 11), auth (Task 15).
- Produces: HTTP endpoints. `POST /api/sessions` body `{ ticket, status, model, effort, autoAdvance, projectName }`. `POST /api/sessions/[id]/advance` body `{ arg: "approve"|"reject"|"local"|"mr" }` (launches the gate stage with the trailing arg). `POST /api/hook?session=&event=` (localhost-only).

- [ ] **Step 1: Write `src/server/autoAdvanceRunner.ts`**

```ts
import type { SessionMeta } from "./types.js";
import { getConfig, getRegistry } from "./app.js";
import { launchSession } from "./launch.js";
import { hasSession, newSession, pipePane } from "./tmux.js";

/** Launch the next stage for a ticket, reusing its model/effort. Best-effort. */
export async function runAutoAdvance(prev: SessionMeta, newStatus: string): Promise<void> {
  const cfg = getConfig();
  await launchSession(
    {
      ticket: prev.ticket,
      status: newStatus,
      model: prev.model,
      effort: prev.effort,
      autoAdvance: prev.autoAdvance,
      projectName: null, // repo already resolvable from the map/worktree
    },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
}
```

- [ ] **Step 2: Write the route handlers**

`src/app/api/tickets/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listOpenIssues } from "@/server/linear";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.json(await listOpenIssues(cfg.linearApiKey));
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
}
```

`src/app/api/sessions/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { launchSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(getRegistry().all());
}

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const body = await req.json();
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      autoAdvance: !!body.autoAdvance, projectName: body.projectName ?? null },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) {
    const status = res.reason === "duplicate" ? 409 : 422;
    return NextResponse.json({ error: res.reason, id: res.id }, { status });
  }
  return NextResponse.json(res.meta, { status: 201 });
}
```

`src/app/api/sessions/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { killSession } from "@/server/tmux";
import { removeSidecar } from "@/server/sidecar";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  await killSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  return new NextResponse(null, { status: 204 });
}
```

`src/app/api/sessions/[id]/advance/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus } from "@/server/linear";
import { launchSession, buildClaudeCommand } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

// Launch the gate stage with a trailing /lime-next arg (approve|reject|local|mr).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const prev = getRegistry().get(id);
  if (!prev) return new NextResponse("not found", { status: 404 });
  const { arg } = await req.json();
  const status = await getIssueStatus(cfg.linearApiKey, prev.ticket);
  const res = await launchSession(
    { ticket: prev.ticket, status, model: prev.model, effort: prev.effort, autoAdvance: prev.autoAdvance, projectName: null },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane,
      // override the command to append the gate arg
      resolveCwd: undefined },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.reason === "duplicate" ? 409 : 422 });
  void buildClaudeCommand; void arg; // arg threading handled in Task 17 note below
  return NextResponse.json(res.meta, { status: 201 });
}
```

Note: to thread the gate `arg` into the command, add an optional `trailingArg?: string` to `LaunchRequest` and, in `buildClaudeCommand`, append it inside the quoted slash command: `"/lime-next RIC-46 approve"`. Update Task 13's `buildClaudeCommand` and `LaunchRequest` accordingly, and pass `trailingArg: arg` here. (This is a one-line addition to the interface defined in Task 13; make it when implementing this task.)

`src/app/api/hook/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { getIssueStatus } from "@/server/linear";
import { handleHook } from "@/server/hookHandler";
import { runAutoAdvance } from "@/server/autoAdvanceRunner";
import type { HookEventName } from "@/server/types";

const VALID: HookEventName[] = ["PermissionRequest", "Notification", "Stop", "SessionEnd"];

export async function POST(req: Request) {
  // Localhost-only: reject if the connection is not from loopback.
  const host = req.headers.get("host") ?? "";
  if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("session") ?? "";
  const event = url.searchParams.get("event") as HookEventName | null;
  if (!event || !VALID.includes(event)) return new NextResponse("bad event", { status: 400 });
  await req.text(); // drain the forwarded hook body (not needed for our logic)
  const cfg = getConfig();
  await handleHook(id, event, {
    registry: getRegistry(),
    bus: getBus(),
    getIssueStatus: (ticket) => getIssueStatus(cfg.linearApiKey, ticket),
    onAutoAdvance: (meta, newStatus) => void runAutoAdvance(meta, newStatus),
  });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Verify routes with the running server (manual)**

Run: `cp .env.example .env` and set real `MOJITO_TOKEN`/`LINEAR_API_KEY`, then `npm run dev`.
Run: `curl -s -H "x-mojito-token: <token>" http://localhost:4711/api/tickets | head`
Expected: a JSON array of your open tickets (or `[]`).
Run: `curl -s http://localhost:4711/api/tickets -o /dev/null -w "%{http_code}\n"`
Expected: `401` (no token).
Run: `curl -s -X POST "http://127.0.0.1:4711/api/hook?session=nope&event=Stop" -d '{}' -o /dev/null -w "%{http_code}\n"`
Expected: `204` (unknown session is a no-op).

- [ ] **Step 4: Commit**

```bash
git add src/app/api src/server/autoAdvanceRunner.ts src/server/launch.ts
git commit -m "feat: add REST + hook API routes"
```

---

### Task 18: Custom server + WS routing + boot recovery

**Files:**
- Create: `server.ts`
- Modify: `src/server/ptyGateway.ts` (created here), `src/server/eventsWs.ts` (created here)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `function attachPty(ws, id, capturePaneFn): void` in `ptyGateway.ts`
  - `function attachEvents(ws, bus): void` in `eventsWs.ts`
  - `server.ts`: boots Next, runs boot recovery (`registry.recover(await listSessions("mojito-"))`), routes `upgrade` events for `/ws/pty` and `/ws/events` (token-checked) to the handlers.

- [ ] **Step 1: Write `src/server/ptyGateway.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/server/eventsWs.ts`**

```ts
import type { WebSocket } from "ws";
import type { EventBus } from "./events.js";

export function attachEvents(ws: WebSocket, bus: EventBus): void {
  const off = bus.subscribe((e) => {
    try {
      ws.send(JSON.stringify(e));
    } catch {
      /* closed */
    }
  });
  ws.on("close", off);
}
```

- [ ] **Step 3: Write `server.ts`**

```ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { getConfig, getRegistry, getBus } from "./src/server/app.js";
import { listSessions } from "./src/server/tmux.js";
import { tokenFromUrl } from "./src/server/auth.js";
import { attachPty } from "./src/server/ptyGateway.js";
import { attachEvents } from "./src/server/eventsWs.js";

const dev = process.env.NODE_ENV !== "production";

async function main() {
  const cfg = getConfig();
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Boot recovery: reconcile the registry with live tmux sessions.
  getRegistry().recover(await listSessions("mojito-"));

  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!tokenFromUrl(url, cfg.token)) {
      socket.destroy();
      return;
    }
    const path = url.split("?")[0];
    if (path === "/ws/pty") {
      const id = new URLSearchParams(url.split("?")[1] ?? "").get("session") ?? "";
      wss.handleUpgrade(req, socket, head, (ws) => attachPty(ws, id));
    } else if (path === "/ws/events") {
      wss.handleUpgrade(req, socket, head, (ws) => attachEvents(ws, getBus()));
    } else {
      socket.destroy();
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
```

- [ ] **Step 4: Verify the server + WS (manual)**

Run: `npm run dev`
Expected: logs `Mojito on http://0.0.0.0:4711`.
Run (in another shell, with tmux + a real ticket): launch a session via `curl -X POST -H "x-mojito-token: <t>" -H "Content-Type: application/json" -d '{"ticket":"RIC-46","status":"Planned"}' http://localhost:4711/api/sessions`
Expected: `201` with the session meta; `tmux ls` shows `mojito-RIC-46-planned`.
Run: connect a WS client to `ws://localhost:4711/ws/events?token=<t>` (e.g. `npx wscat`) — expect to receive `session.state`/`session.alert` frames as the session progresses.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/server/ptyGateway.ts src/server/eventsWs.ts
git commit -m "feat: add custom server with pty and events websockets"
```

---

## Phase 5 — Client

### Task 19: Client lib + token gate + data hooks

**Files:**
- Create: `src/lib/useToken.ts`, `src/lib/client.ts`, `src/lib/useTickets.ts`, `src/lib/useSessions.ts`, `src/lib/useEvents.ts`

**Interfaces:**
- Produces:
  - `useToken(): { token; setToken }` (localStorage-backed)
  - `apiFetch(token, path, init?): Promise<Response>` (adds `x-mojito-token`)
  - `useTickets(token): { tickets; refresh; error }` (polls every 45s)
  - `useSessions(token): { sessions; refresh }`
  - `useEvents(token, onEvent): void` (opens `/ws/events`, auto-reconnects)

- [ ] **Step 1: Write the modules**

`src/lib/useToken.ts`:
```tsx
"use client";
import { useEffect, useState } from "react";

export function useToken() {
  const [token, setTokenState] = useState<string>("");
  useEffect(() => {
    setTokenState(localStorage.getItem("mojito-token") ?? "");
  }, []);
  const setToken = (t: string) => {
    localStorage.setItem("mojito-token", t);
    setTokenState(t);
  };
  return { token, setToken };
}
```

`src/lib/client.ts`:
```ts
export function apiFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-mojito-token": token, "Content-Type": "application/json" },
  });
}
```

`src/lib/useTickets.ts`:
```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { TicketSummary } from "@/server/types";

export function useTickets(token: string) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/tickets");
      if (!res.ok) throw new Error(String(res.status));
      setTickets(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [token]);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 45000);
    return () => clearInterval(iv);
  }, [refresh]);
  return { tickets, refresh, error };
}
```

`src/lib/useSessions.ts`:
```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { SessionMeta } from "@/server/types";

export function useSessions(token: string) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await apiFetch(token, "/api/sessions");
    if (res.ok) setSessions(await res.json());
  }, [token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { sessions, setSessions, refresh };
}
```

`src/lib/useEvents.ts`:
```tsx
"use client";
import { useEffect } from "react";
import type { MojitoEvent } from "@/server/events";

export function useEvents(token: string, onEvent: (e: MojitoEvent) => void) {
  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/events?token=${encodeURIComponent(token)}`);
      ws.onmessage = (m) => onEvent(JSON.parse(m.data));
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [token, onEvent]);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib
git commit -m "feat: add client data hooks and token gate"
```

---

### Task 20: App shell + tabs + PWA + token entry

**Files:**
- Modify: `src/app/page.tsx`
- Create: `public/manifest.webmanifest`, `public/sw.js`, `public/alert.mp3` (any short sound), `src/components/TokenGate.tsx`
- Modify: `src/app/layout.tsx` (link manifest, register SW)

**Interfaces:**
- Consumes: `useToken`, `useEvents`, `useSessions`, `useTickets`.
- Produces: the tab shell holding `TicketList` and `SessionList`, an alert badge on the Sessions tab, and a token entry screen when no token is set.

- [ ] **Step 1: Create the PWA manifest + service worker**

`public/manifest.webmanifest`:
```json
{
  "name": "Mojito",
  "short_name": "Mojito",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0c",
  "theme_color": "#0b0b0c",
  "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }]
}
```

`public/sw.js`:
```js
// Minimal SW for installability only (no offline caching, no push).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
```

Add `public/icon-192.png` (any 192×192 PNG) and `public/alert.mp3` (any short notification sound).

- [ ] **Step 2: Link the manifest and register the SW in `layout.tsx`**

Add to `layout.tsx` metadata and body:
```tsx
export const metadata = { title: "Mojito", manifest: "/manifest.webmanifest" };
```
Append inside `<body>` a small client component `<SwRegister />`:

`src/components/SwRegister.tsx`:
```tsx
"use client";
import { useEffect } from "react";
export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
```

- [ ] **Step 3: Create `TokenGate.tsx`**

```tsx
"use client";
import { useState } from "react";

export default function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <main style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
      <h1>Mojito</h1>
      <p>Enter your access token.</p>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="token"
        style={{ width: "100%", padding: 12, fontSize: 16 }} />
      <button onClick={() => onSet(v)} style={{ marginTop: 12, padding: 12, width: "100%" }}>Save</button>
    </main>
  );
}
```

- [ ] **Step 4: Write the tab shell `page.tsx`**

```tsx
"use client";
import { useCallback, useState } from "react";
import { useToken } from "@/lib/useToken";
import { useTickets } from "@/lib/useTickets";
import { useSessions } from "@/lib/useSessions";
import { useEvents } from "@/lib/useEvents";
import TokenGate from "@/components/TokenGate";
import TicketList from "@/components/TicketList";
import SessionList from "@/components/SessionList";
import AlertLayer from "@/components/AlertLayer";
import TerminalView from "@/components/TerminalView";
import type { MojitoEvent } from "@/server/events";
import type { SessionMeta } from "@/server/types";

export default function Home() {
  const { token, setToken } = useToken();
  const [tab, setTab] = useState<"tickets" | "sessions">("tickets");
  const [open, setOpen] = useState<SessionMeta | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; ticket: string; message: string }[]>([]);
  const { tickets, refresh: refreshTickets } = useTickets(token);
  const { sessions, refresh: refreshSessions } = useSessions(token);

  const onEvent = useCallback((e: MojitoEvent) => {
    refreshSessions();
    if (e.type === "session.alert") setAlerts((a) => [{ id: e.id, ticket: e.ticket, message: e.message }, ...a].slice(0, 20));
  }, [refreshSessions]);
  useEvents(token, onEvent);

  if (!token) return <TokenGate onSet={setToken} />;
  if (open) return <TerminalView token={token} session={open} onBack={() => setOpen(null)} />;

  const needsInput = sessions.filter((s) => s.state === "needs-input").length;

  return (
    <div style={{ paddingBottom: 64 }}>
      <AlertLayer alerts={alerts} onOpen={(id) => { const s = sessions.find((x) => x.id === id); if (s) setOpen(s); }} onClear={() => setAlerts([])} />
      {tab === "tickets"
        ? <TicketList token={token} tickets={tickets} sessions={sessions} onLaunched={() => { refreshSessions(); refreshTickets(); }} onOpen={setOpen} />
        : <SessionList token={token} sessions={sessions} onOpen={setOpen} onChanged={refreshSessions} />}
      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", borderTop: "1px solid #222" }}>
        <button onClick={() => setTab("tickets")} style={{ flex: 1, padding: 16 }}>Tickets</button>
        <button onClick={() => setTab("sessions")} style={{ flex: 1, padding: 16 }}>
          Sessions{needsInput ? ` (${needsInput})` : ""}
        </button>
      </nav>
    </div>
  );
}
```

- [ ] **Step 5: Verify install + token gate (manual)**

Run: `npm run dev`, open on the phone via `http://<LAN-IP>:4711`.
Expected: token screen; after entering the token, the tab shell appears; the browser offers "Add to Home Screen".

- [ ] **Step 6: Commit**

```bash
git add src/app src/components/SwRegister.tsx src/components/TokenGate.tsx public
git commit -m "feat: add app shell, tabs, PWA manifest, token gate"
```

---

### Task 21: TicketList + LaunchSheet

**Files:**
- Create: `src/components/TicketList.tsx`, `src/components/LaunchSheet.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `TicketSummary`, `SessionMeta`, `tmuxName`.
- Produces: grouped ticket cards; tapping opens `LaunchSheet` (model/effort/auto-advance + Start). If a session for that ticket+status exists, the sheet shows **Open** instead of Start.

- [ ] **Step 1: Write `LaunchSheet.tsx`**

```tsx
"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { tmuxName } from "@/server/sessionKey";
import type { SessionMeta, TicketSummary } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export default function LaunchSheet(
  { token, ticket, sessions, onClose, onLaunched, onOpen }:
  { token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
    onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const existingId = tmuxName(ticket.identifier, ticket.statusName);
  const existing = sessions.find((s) => s.id === existingId);

  const start = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ ticket: ticket.identifier, status: ticket.statusName, model, effort,
        autoAdvance: auto, projectName: ticket.project }),
    });
    if (res.status === 409) { setErr("A session for this ticket+status already exists."); return; }
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: "#151517", width: "100%", padding: 20, borderRadius: "16px 16px 0 0" }} onClick={(e) => e.stopPropagation()}>
        <h3>{ticket.identifier} · {ticket.statusName}</h3>
        {existing ? (
          <button style={{ width: "100%", padding: 14 }} onClick={() => onOpen(existing)}>Open running session</button>
        ) : (
          <>
            <label>Model <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label style={{ marginLeft: 12 }}>Effort <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label style={{ display: "block", margin: "12px 0" }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            <button style={{ width: "100%", padding: 14 }} onClick={start}>Start</button>
          </>
        )}
        {err && <p style={{ color: "#f88" }}>{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `TicketList.tsx`**

```tsx
"use client";
import { useState } from "react";
import LaunchSheet from "./LaunchSheet";
import type { SessionMeta, TicketSummary } from "@/server/types";

export default function TicketList(
  { token, tickets, sessions, onLaunched, onOpen }:
  { token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void; onOpen: (s: SessionMeta) => void },
) {
  const [picked, setPicked] = useState<TicketSummary | null>(null);
  const groups = tickets.reduce<Record<string, TicketSummary[]>>((acc, t) => {
    (acc[t.project ?? "No project"] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div style={{ padding: 12 }}>
      {Object.entries(groups).map(([project, items]) => (
        <section key={project}>
          <h4 style={{ opacity: 0.6 }}>{project}</h4>
          {items.map((t) => (
            <button key={t.identifier} onClick={() => setPicked(t)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: 14, margin: "8px 0", background: "#151517", border: "1px solid #222", borderRadius: 12 }}>
              <strong>{t.identifier}</strong> · {t.statusName}
              <div>{t.title}</div>
              {t.labels.length > 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>{t.labels.join(", ")}</div>}
            </button>
          ))}
        </section>
      ))}
      {picked && (
        <LaunchSheet token={token} ticket={picked} sessions={sessions}
          onClose={() => setPicked(null)} onLaunched={onLaunched} onOpen={(s) => { setPicked(null); onOpen(s); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + manual verify**

Run: `npm run typecheck`
Expected: no errors.
Manual: on the phone, tap a ticket → sheet with model/effort/auto-advance → Start launches; tapping the same ticket again shows "Open running session".

- [ ] **Step 4: Commit**

```bash
git add src/components/TicketList.tsx src/components/LaunchSheet.tsx
git commit -m "feat: add ticket list and launch sheet"
```

---

### Task 22: SessionList

**Files:**
- Create: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `SessionMeta`.
- Produces: session cards with a state badge, model·effort, auto-advance indicator, message line, a highlight for `needs-input`, and a dismiss button (confirm when running).

- [ ] **Step 1: Write `SessionList.tsx`**

```tsx
"use client";
import { apiFetch } from "@/lib/client";
import type { SessionMeta, SessionState } from "@/server/types";

const BADGE: Record<SessionState, string> = {
  starting: "…", running: "●", "needs-input": "⚠", done: "✓", failed: "✕",
};

export default function SessionList(
  { token, sessions, onOpen, onChanged }:
  { token: string; sessions: SessionMeta[]; onOpen: (s: SessionMeta) => void; onChanged: () => void },
) {
  const dismiss = async (s: SessionMeta) => {
    if (s.state === "running" || s.state === "needs-input") {
      if (!confirm(`Kill the running session for ${s.ticket}?`)) return;
    }
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div style={{ padding: 12 }}>
      {sessions.length === 0 && <p style={{ opacity: 0.6 }}>No sessions.</p>}
      {sessions.map((s) => (
        <div key={s.id}
          style={{ padding: 14, margin: "8px 0", borderRadius: 12,
            background: s.state === "needs-input" ? "#2a1f10" : "#151517",
            border: `1px solid ${s.state === "needs-input" ? "#a70" : "#222"}` }}>
          <div onClick={() => onOpen(s)} style={{ cursor: "pointer" }}>
            <strong>{s.ticket} · {s.launchStatus}</strong> <span>{BADGE[s.state]}</span>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{s.model}·{s.effort}{s.autoAdvance ? " · auto" : ""}</div>
            {s.message && <div style={{ fontSize: 13 }}>{s.message}</div>}
          </div>
          <button onClick={() => dismiss(s)} style={{ marginTop: 8, fontSize: 12 }}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + manual verify**

Run: `npm run typecheck`
Expected: no errors.
Manual: launch a session → it appears; when claude asks for permission the card turns amber with ⚠; Dismiss on a running session prompts for confirmation.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionList.tsx
git commit -m "feat: add session list with state badges and dismiss"
```

---

### Task 23: TerminalView + AccessoryBar

**Files:**
- Create: `src/components/TerminalView.tsx`, `src/components/AccessoryBar.tsx`

**Interfaces:**
- Consumes: `@xterm/xterm`, `@xterm/addon-fit`, `SessionMeta`, gate constants (`GATE_STATES`).
- Produces: full-screen xterm attached to `/ws/pty?session=<id>&token=`, auto-reconnect, resize→`{resize}` control frame, keystrokes as binary frames; `AccessoryBar` sends special keys; gate action buttons post to `/advance`.

- [ ] **Step 1: Write `AccessoryBar.tsx`**

```tsx
"use client";

const KEYS: { label: string; bytes: string }[] = [
  { label: "Esc", bytes: "\x1b" },
  { label: "Tab", bytes: "\t" },
  { label: "↑", bytes: "\x1b[A" },
  { label: "↓", bytes: "\x1b[B" },
  { label: "←", bytes: "\x1b[D" },
  { label: "→", bytes: "\x1b[C" },
  { label: "⏎", bytes: "\r" },
  { label: "^C", bytes: "\x03" },
  { label: "1", bytes: "1" },
  { label: "2", bytes: "2" },
  { label: "3", bytes: "3" },
];

export default function AccessoryBar({ onSend }: { onSend: (bytes: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: 8, borderTop: "1px solid #222" }}>
      {KEYS.map((k) => (
        <button key={k.label} onClick={() => onSend(k.bytes)}
          style={{ padding: "10px 12px", background: "#222", borderRadius: 8, whiteSpace: "nowrap" }}>{k.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `TerminalView.tsx`**

```tsx
"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import AccessoryBar from "./AccessoryBar";
import { apiFetch } from "@/lib/client";
import { GATE_STATES } from "@/server/autoAdvance";
import type { SessionMeta } from "@/server/types";

export default function TerminalView(
  { token, session, onBack }: { token: string; session: SessionMeta; onBack: () => void },
) {
  const holder = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const term = new Terminal({ fontSize: 13, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder.current!);
    fit.fit();
    termRef.current = term;

    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/pty?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(token)}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        fit.fit();
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      };
      ws.onmessage = (m) => term.write(typeof m.data === "string" ? m.data : new Uint8Array(m.data));
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 1500); };
    };
    connect();

    const onData = term.onData((d) => wsRef.current?.send(new TextEncoder().encode(d)));
    const onResize = () => {
      fit.fit();
      wsRef.current?.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
    };
    window.addEventListener("resize", onResize);

    return () => {
      closed = true;
      clearTimeout(retry);
      onData.dispose();
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      term.dispose();
    };
  }, [session.id, token]);

  const send = (bytes: string) => wsRef.current?.send(new TextEncoder().encode(bytes));
  const isGate = GATE_STATES.includes(session.launchStatus);
  const advance = async (arg: string) => {
    await apiFetch(token, `/api/sessions/${session.id}/advance`, { method: "POST", body: JSON.stringify({ arg }) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{ padding: 12, borderBottom: "1px solid #222" }}>
        <button onClick={onBack}>‹</button> {session.ticket} · {session.launchStatus}
      </header>
      <div ref={holder} style={{ flex: 1, overflow: "hidden" }} />
      {isGate ? (
        <div style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid #222" }}>
          {(session.launchStatus === "To QA" ? ["approve", "reject"] : ["local", "mr"]).map((a) => (
            <button key={a} onClick={() => advance(a)} style={{ flex: 1, padding: 12 }}>{a}</button>
          ))}
        </div>
      ) : (
        <AccessoryBar onSend={send} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + manual verify**

Run: `npm run typecheck`
Expected: no errors.
Manual (phone): open a running session → the terminal renders claude's TUI; the accessory bar sends Esc/arrows/Enter/^C and the `1/2/3` chips answer numbered prompts; background the app and return → reconnect shows a coherent screen (scrollback replayed).

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalView.tsx src/components/AccessoryBar.tsx
git commit -m "feat: add terminal view with xterm, reconnect, and accessory bar"
```

---

### Task 24: AlertLayer

**Files:**
- Create: `src/components/AlertLayer.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a toast stack rendered from the alert list; plays `/alert.mp3` on a new alert (audio unlocked on first user gesture); tapping a toast calls `onOpen(id)`.

- [ ] **Step 1: Write `AlertLayer.tsx`**

```tsx
"use client";
import { useEffect, useRef } from "react";

export default function AlertLayer(
  { alerts, onOpen, onClear }:
  { alerts: { id: string; ticket: string; message: string }[]; onOpen: (id: string) => void; onClear: () => void },
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const unlocked = useRef(false);

  useEffect(() => {
    const unlock = () => { unlocked.current = true; };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (alerts.length && unlocked.current) audio.current?.play().catch(() => {});
  }, [alerts.length]);

  if (alerts.length === 0) return <audio ref={audio} src="/alert.mp3" preload="auto" />;
  const top = alerts[0];
  return (
    <>
      <audio ref={audio} src="/alert.mp3" preload="auto" />
      <div style={{ position: "fixed", top: 8, left: 8, right: 8, zIndex: 50 }}>
        <div onClick={() => onOpen(top.id)}
          style={{ background: "#a70", color: "#fff", padding: 14, borderRadius: 12 }}>
          <strong>{top.ticket}</strong> — {top.message}
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={{ float: "right" }}>×</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + manual verify**

Run: `npm run typecheck`
Expected: no errors.
Manual (phone): trigger a permission prompt in claude → a toast appears, the sound plays (after your first tap on the page), and tapping the toast opens that session's terminal.

- [ ] **Step 3: Commit**

```bash
git add src/components/AlertLayer.tsx
git commit -m "feat: add in-app alert layer with sound and deep-link"
```

---

## Phase 6 — Integration & smoke

### Task 25: Full-flow smoke test (documented, manual)

**Files:**
- Create: `docs/superpowers/plans/smoke-checklist.md`

**Interfaces:**
- Consumes: the whole system.
- Produces: a reproducible manual verification, run against a real Linear ticket + tmux + claude.

- [ ] **Step 1: Write the smoke checklist**

`docs/superpowers/plans/smoke-checklist.md`:
```markdown
# Mojito smoke checklist

Prereqs: tmux + claude on PATH, a real non-closed Linear ticket, `.env` filled in, `npm run dev` running, phone on the same LAN.

0. **Stop-vs-SessionEnd behavior (verify FIRST — spec §3 caveat).**
   Launch `claude "/lime-next <TICKET>"` manually in a terminal. After the stage's
   turn completes, observe whether claude stays interactive (fires `Stop`) or exits
   (fires `SessionEnd`). Confirm the injected hooks POST to `/api/hook`. Record which
   event fires at stage end; both are handled, but this confirms the assumption.

1. Open `http://<LAN-IP>:4711` on the phone, enter the token → tab shell appears.
2. Tickets tab lists your non-closed tickets grouped by project.
3. Tap a ticket → launch sheet (model=opus, effort=high default) → Start → 201.
   `tmux ls` shows `mojito-<TICKET>-<slug>`.
4. Sessions tab shows the session as running (●).
5. When claude asks for a permission → card turns amber (⚠), a toast + sound fire.
6. Open the terminal → claude's TUI renders; answer with the accessory bar (`1/2/3`, Enter).
7. Let the stage finish → status advances in Linear → card shows done (✓), "stage complete" alert.
8. Background the phone during a running session, return → terminal reconnects with scrollback.
9. Dismiss a done session → it disappears; `tmux ls` no longer lists it.
10. Try launching the same ticket+status twice → the sheet shows "Open running session" (dedup).
11. Enable auto-advance on a ticket → after a non-gate stage completes, the next stage launches automatically.
12. Reach a gate (To QA / To Merge) → auto-advance stops; the terminal shows gate buttons; tapping posts the arg.
13. Restart `npm run dev` mid-session → the session reappears (boot recovery) and the terminal reattaches.
```

- [ ] **Step 2: Run the smoke checklist end to end**

Run: work through every item on a phone against a real ticket.
Expected: all items pass. Fix any failures before declaring done. Item 0 may reveal that stage-end fires `SessionEnd` rather than `Stop` — both are already handled identically via the status cross-check, so no code change is needed either way; just record the observed behavior.

- [ ] **Step 3: Run the full unit + integration suite**

Run: `npm run test`
Expected: all vitest specs pass (tmux integration test passes when tmux is installed).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/smoke-checklist.md
git commit -m "docs: add end-to-end smoke checklist"
```

---

## Self-Review

**1. Spec coverage:**
- Runtime LAN / mobile-first / single user → Tasks 20–24 (PWA, mobile layout), token auth (Tasks 15–17).
- tmux durable store, session-per-(ticket+status), dedup → Tasks 3, 11, 13.
- Launch with model/effort (default opus/high) → Tasks 13, 21.
- Hook-based detection (no idle), Stop+Linear disambiguation → Tasks 4, 5, 16, 17.
- Sessions stay `done` until dismissed; never killed on disconnect → Tasks 12, 18 (`ptyGateway` kills pty only), 22.
- Auto-advance per-ticket + gates → Tasks 6, 16, 17 (advance route), 23 (gate buttons).
- Terminal transport (WS + node-pty attach, reconnect, scrollback, mobile keyboard) → Tasks 18, 23.
- Linear (API key, open tickets, status poll, repo/worktree resolution) → Tasks 7, 8, 9, 17.
- In-app alerts (toast + sound + badge + deep-link) → Tasks 20, 24.
- Boot recovery → Tasks 12, 18.
- Security (token on REST+WS, hook localhost-only) → Tasks 15, 17, 18.
- Testing (unit/integration/manual smoke, Stop-vs-SessionEnd first) → all TDD tasks + Task 25.

**2. Placeholder scan:** The only forward-reference is the gate-`arg` threading noted in Task 17, which specifies the exact one-line change to Task 13's `buildClaudeCommand`/`LaunchRequest` (`trailingArg?: string`, appended inside the quoted slash command). Implement that when doing Task 17. No "TBD"/"handle appropriately"/empty-test placeholders remain.

**3. Type consistency:** `SessionMeta.id` = tmux name throughout; `tmuxName()` used identically in launch (server) and LaunchSheet (client); `HookEventName` shared across `hookSettings`, `hookMap`, `hookHandler`, and the hook route; `MojitoEvent` shared between `events.ts`, `eventsWs.ts`, and `useEvents`; `Effort` consistent server↔client.
