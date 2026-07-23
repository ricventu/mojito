# Project Stacks (start/stop/logs/pull) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stacks" panel to the Mojito UI that starts/stops/tails each mapped project's dev stack (`scripts/start.sh` in a `stack-<slug>` tmux session) and offers a fast-forward Pull (+ "Resolve with Claude") on every row except Mojito's own.

**Architecture:** A new server module `src/server/projectStack.ts` owns stack lifecycle + pull, driven by injected tmux/fs/git dependencies (same DI style as `ffPull`/`launch`). Five App-Router routes under `src/app/api/stacks/**` expose it. Pull reuses RIC-164's shared `ffPull` helper; only a per-slug single-flight is local. The UI is a thin React panel whose testable logic lives in pure `src/lib/stacks.ts` helpers (the repo has no React test runner — logic is unit-tested, the component is verified by `tsc` + running the app).

**Tech Stack:** Next.js 15 (App Router), TypeScript, React (client components), tmux via `execFile`, vitest (node env, no testing-library).

## Global Constraints

- **English only** — all identifiers, comments, log/error strings, commit messages (per CLAUDE.md). User-facing UI copy is English too (no i18n layer in this app).
- **Test command (run after every task):** `npx tsc --noEmit && npx vitest run` — both must pass.
- **No shell interpolation for tmux/git** — every tmux/git call goes through `execFile` with an args array (never a shell string built from project data). The only user-derived value reaching a command is the slug, sanitized to `[a-z0-9-]` by `statusSlug`.
- **Resolve command carries no client string** — the seeded Claude prompt is built server-side from server-derived values only (project name, repo path, current branch); the pull-failure `detail` is never interpolated into the command.
- **Session prefix `stack-`** — deliberately outside the `mojito-*` namespace that boot recovery reconciles (`server.ts` lists `mojito-` only). Stack sessions are NOT in the session registry.
- **Mojito self-row is not pullable** — identified server-side by comparing each mapped repo path against the server's own repo root (`process.cwd()`, resolved), never by matching the project name.
- **Next 15 dynamic params are async** — handler second arg is `{ params }: { params: Promise<{ slug: string }> }`; read via `const { slug } = await params;`. Route tests pass `{ params: Promise.resolve({ slug }) }`.
- **DI over module mocking for I/O** — prefer injected fakes (like `GitRun`) over mocking `node:child_process`/`node:fs`. `getConfig()` memoizes, so tests set `MOJITO_TOKEN`/`LINEAR_API_KEY` env in `beforeEach` and send the `x-mojito-token` header.
- **Frequent commits** — one commit per task (message shown in each task's final step).

## File Structure

- Create `src/lib/stacks.ts` — client-safe shared types (`StackStatus`, `StackRow`) + pure UI helpers (pull-response → message, synthetic terminal session). Imported by both server and client.
- Create `src/server/projectStack.ts` — stack lifecycle + pull orchestration (DI).
- Modify `src/server/sessionKey.ts` — add `stackSessionName(slug)`.
- Modify `src/server/tmux.ts` — add `startStackSession` (create + window-scoped `remain-on-exit`) and `panesDead` (query `#{pane_dead}`).
- Modify `src/server/launch.ts` — add optional `prompt` to `CustomLaunchRequest` + `buildCustomClaudeCommand`; add `buildResolvePrompt` + `launchStackResolveSession`.
- Create `src/app/api/stacks/route.ts` — `GET`.
- Create `src/app/api/stacks/[slug]/start/route.ts`, `.../stop/route.ts`, `.../pull/route.ts`, `.../resolve/route.ts` — `POST` each.
- Create `src/lib/useStacks.ts` — light-polling hook (thin; no test).
- Create `src/components/StacksPanel.tsx` — the panel (thin; no test).
- Modify `src/app/page.tsx` — add the Stacks tab, open `stack-<slug>` logs in `TerminalView`, focus the resolve session.
- Tests: `tests/server/sessionKey.test.ts`, `tests/server/tmux.integration.test.ts` (extend), `tests/server/projectStack.test.ts`, `tests/server/launch.test.ts` (extend or create), `tests/server/stacksRoute.test.ts`, `tests/lib/stacks.test.ts`.

> **Out of this plan (separate repos):** the `scripts/start.sh` files for Factorybook and GestionaleCooperativeMvp live in their own repos and are cross-repo follow-ups (see the spec's Adoption note). This plan delivers the Mojito-side feature; it works the moment those repos add a `start.sh`, and shows them as pull-only rows until then.

---

### Task 1: `stackSessionName` in sessionKey

**Files:**
- Modify: `src/server/sessionKey.ts`
- Test: `tests/server/sessionKey.test.ts` (create)

**Interfaces:**
- Consumes: existing `statusSlug(status: string): string`.
- Produces: `stackSessionName(slug: string): string` → `stack-<slug>`.

- [ ] **Step 1: Write the failing test** — create `tests/server/sessionKey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stackSessionName, statusSlug } from "@/server/sessionKey";

describe("stackSessionName", () => {
  it("prefixes the slug with stack-", () => {
    expect(stackSessionName("factorybook")).toBe("stack-factorybook");
  });
  it("uses an already-sanitized slug verbatim", () => {
    expect(stackSessionName(statusSlug("Gestionale Cooperative"))).toBe("stack-gestionale-cooperative");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — `stackSessionName` is not exported.

- [ ] **Step 3: Add the helper** — append to `src/server/sessionKey.ts` (after `shellSessionName`):

```ts
export function stackSessionName(slug: string): string {
  return `stack-${slug}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/sessionKey.ts tests/server/sessionKey.test.ts
git commit -m "feat(server): add stackSessionName for stack-<slug> tmux sessions (RIC-165)"
```

---

### Task 2: tmux stack primitives (`startStackSession`, `panesDead`)

**Files:**
- Modify: `src/server/tmux.ts`
- Test: `tests/server/tmux.integration.test.ts` (extend — gated on tmux availability)

**Interfaces:**
- Consumes: existing `pexec` (promisified `execFile`), `hasSession`, `killSession`.
- Produces:
  - `startStackSession(name: string, cwd: string, command: string): Promise<void>` — creates a detached session and sets `remain-on-exit on` window-scoped, atomically, so a crashed pane is retained.
  - `panesDead(name: string): Promise<string>` — raw `#{pane_dead}` output (`"0"`/`"1"` per pane, newline-separated). Empty string if the session is gone.

Rationale: `remain-on-exit` is a window option. Setting it after the process has already exited is too late (the window vanishes), so it is set in the SAME tmux invocation as `new-session` via a `;` command separator (passed as its own argv token — no shell).

- [ ] **Step 1: Write the failing test** — add to `tests/server/tmux.integration.test.ts` inside its existing tmux-gated `describe` (mirror the existing create/kill test's structure and its skip-when-unavailable guard):

```ts
it("retains a crashed pane via remain-on-exit and reports pane_dead", async () => {
  const name = "mojito-test-stack-crash";
  await killSession(name).catch(() => {});
  // A command that exits immediately (non-zero) simulates a crashed stack.
  await startStackSession(name, process.cwd(), "bash -lc 'exit 1'");
  // Give tmux a moment to run and mark the pane dead.
  await new Promise((r) => setTimeout(r, 300));
  expect(await hasSession(name)).toBe(true); // remain-on-exit kept it
  expect((await panesDead(name)).trim()).toBe("1");
  await killSession(name);
  expect(await hasSession(name)).toBe(false);
});

it("reports a live pane as not dead", async () => {
  const name = "mojito-test-stack-live";
  await killSession(name).catch(() => {});
  await startStackSession(name, process.cwd(), "sleep 30");
  await new Promise((r) => setTimeout(r, 200));
  expect((await panesDead(name)).trim()).toBe("0");
  await killSession(name);
});
```

Ensure `startStackSession` and `panesDead` are added to the file's import from `@/server/tmux`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/tmux.integration.test.ts`
Expected: FAIL — `startStackSession`/`panesDead` not exported (or the whole suite skips if tmux is unavailable — if skipped, note it and proceed; these run on the Mac/server where tmux exists).

- [ ] **Step 3: Add the helpers** — in `src/server/tmux.ts`, after `newSession`:

```ts
export async function startStackSession(name: string, cwd: string, command: string): Promise<void> {
  // Create the session and set remain-on-exit window-scoped in the SAME invocation,
  // so a pane that dies immediately is retained (status "crashed") instead of vanishing.
  await pexec("tmux", [
    "new-session", "-d", "-s", name, "-c", cwd, command,
    ";",
    "set-option", "-w", "-t", name, "remain-on-exit", "on",
  ]);
}

export async function panesDead(name: string): Promise<string> {
  try {
    const { stdout } = await pexec("tmux", ["list-panes", "-t", name, "-F", "#{pane_dead}"]);
    return stdout;
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/tmux.integration.test.ts`
Expected: PASS on a machine with tmux (skips otherwise).

- [ ] **Step 5: Commit**

```bash
git add src/server/tmux.ts tests/server/tmux.integration.test.ts
git commit -m "feat(server): add tmux startStackSession + panesDead for stack lifecycle (RIC-165)"
```

---

### Task 3: `projectStack` types, `resolveStack`, `listStacks`

**Files:**
- Create: `src/lib/stacks.ts` (shared types)
- Create: `src/server/projectStack.ts`
- Test: `tests/server/projectStack.test.ts` (create)

**Interfaces:**
- Consumes: `listMappedProjects`, `loadProjectMap`, `resolvePathForProject` (`@/server/limeProjects`); `statusSlug`, `stackSessionName` (`@/server/sessionKey`); `hasSession`, `panesDead` (`@/server/tmux`).
- Produces (in `src/lib/stacks.ts`):
  ```ts
  export type StackStatus = "running" | "stopped" | "crashed";
  export interface StackRow {
    project: string;
    slug: string;
    hasStack: boolean;
    status: StackStatus | null; // null when !hasStack
    pullable: boolean;
  }
  ```
- Produces (in `src/server/projectStack.ts`):
  - `interface StackDeps` — injected I/O with real defaults.
  - `resolveStack(slug: string, deps: StackDeps): StackTarget | null` where `StackTarget = { project: string; path: string; hasStack: boolean; pullable: boolean }`.
  - `listStacks(deps: StackDeps): Promise<StackRow[]>`.

- [ ] **Step 1: Create the shared types** — `src/lib/stacks.ts`:

```ts
export type StackStatus = "running" | "stopped" | "crashed";

export interface StackRow {
  project: string;
  slug: string;
  hasStack: boolean;
  status: StackStatus | null; // meaningful only when hasStack
  pullable: boolean; // false for the Mojito self-row
}
```

- [ ] **Step 2: Write the failing test** — `tests/server/projectStack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { listStacks, resolveStack, type StackDeps } from "@/server/projectStack";

// A fake project map: Mojito (self), Factorybook (has start.sh), Lime (no start.sh),
// "Gestionale Cooperative" (has start.sh, space in name -> slug check).
const SELF = "/repo/mojito";
const MAP = {
  RIC: {
    projects: {
      Mojito: "/repo/mojito",
      Factorybook: "/repo/fb",
      Lime: "/repo/lime",
      "Gestionale Cooperative": "/repo/gc",
    },
  },
};
const EXECUTABLE = new Set(["/repo/fb/scripts/start.sh", "/repo/gc/scripts/start.sh"]);

function deps(over: Partial<StackDeps> = {}): StackDeps {
  return {
    projectsPath: "/ignored",
    selfPath: SELF,
    loadMap: () => MAP as never,
    isExecutable: (p) => EXECUTABLE.has(p),
    hasSession: async () => false,
    panesDead: async () => "",
    startSession: async () => {},
    killSession: async () => {},
    ...over,
  };
}

describe("listStacks", () => {
  it("lists every mapped project sorted by name, with hasStack + pullable", async () => {
    const rows = await listStacks(deps());
    expect(rows.map((r) => r.project)).toEqual([
      "Factorybook", "Gestionale Cooperative", "Lime", "Mojito",
    ]);
    const fb = rows.find((r) => r.project === "Factorybook")!;
    expect(fb).toMatchObject({ slug: "factorybook", hasStack: true, pullable: true });
    const gc = rows.find((r) => r.project === "Gestionale Cooperative")!;
    expect(gc.slug).toBe("gestionale-cooperative");
    const lime = rows.find((r) => r.project === "Lime")!;
    expect(lime).toMatchObject({ hasStack: false, status: null, pullable: true });
  });

  it("flags the Mojito self-row (path === selfPath) as not pullable", async () => {
    const rows = await listStacks(deps());
    const mojito = rows.find((r) => r.project === "Mojito")!;
    expect(mojito.pullable).toBe(false);
  });

  it("derives status: no session -> stopped; live pane -> running; dead pane -> crashed", async () => {
    const running = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "0\n" }));
    expect(running.find((r) => r.project === "Factorybook")!.status).toBe("running");
    const crashed = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "1\n" }));
    expect(crashed.find((r) => r.project === "Factorybook")!.status).toBe("crashed");
    const stopped = await listStacks(deps({ hasSession: async () => false }));
    expect(stopped.find((r) => r.project === "Factorybook")!.status).toBe("stopped");
  });

  it("leaves status null for projects without start.sh", async () => {
    const rows = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "0\n" }));
    expect(rows.find((r) => r.project === "Lime")!.status).toBeNull();
  });
});

describe("resolveStack", () => {
  it("finds a project by slug and reports hasStack + pullable", () => {
    expect(resolveStack("factorybook", deps())).toEqual({
      project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true,
    });
    expect(resolveStack("mojito", deps())).toMatchObject({ pullable: false });
  });
  it("returns null for an unknown slug", () => {
    expect(resolveStack("nope", deps())).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/projectStack.test.ts`
Expected: FAIL — module `@/server/projectStack` does not exist.

- [ ] **Step 4: Implement `resolveStack` + `listStacks`** — create `src/server/projectStack.ts`:

```ts
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { listMappedProjects, loadProjectMap, type ProjectMap } from "./limeProjects.js";
import { statusSlug, stackSessionName } from "./sessionKey.js";
import { hasSession as tmuxHasSession, panesDead as tmuxPanesDead, startStackSession, killSession as tmuxKillSession } from "./tmux.js";
import type { StackRow, StackStatus } from "@/lib/stacks";

export interface StackDeps {
  projectsPath: string;
  selfPath: string; // the server's own repo root (process.cwd()); its row is not pullable
  loadMap?: (path: string) => ProjectMap;
  isExecutable?: (p: string) => boolean;
  hasSession?: (name: string) => Promise<boolean>;
  panesDead?: (name: string) => Promise<string>;
  startSession?: (name: string, cwd: string, command: string) => Promise<void>;
  killSession?: (name: string) => Promise<void>;
}

export interface StackTarget {
  project: string;
  path: string;
  hasStack: boolean;
  pullable: boolean;
}

function defaultIsExecutable(p: string): boolean {
  try {
    const s = statSync(p);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function paneStatus(raw: string): StackStatus {
  const panes = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  return panes.some((d) => d === "1") ? "crashed" : "running";
}

export function resolveStack(slug: string, deps: StackDeps): StackTarget | null {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const match = listMappedProjects(loadMap(deps.projectsPath)).find((p) => statusSlug(p.name) === slug);
  if (!match) return null;
  return {
    project: match.name,
    path: match.path,
    hasStack: isExecutable(join(match.path, "scripts", "start.sh")),
    pullable: resolve(match.path) !== resolve(deps.selfPath),
  };
}

async function statusOf(slug: string, deps: StackDeps): Promise<StackStatus> {
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const panesDead = deps.panesDead ?? tmuxPanesDead;
  const name = stackSessionName(slug);
  if (!(await hasSession(name))) return "stopped";
  return paneStatus(await panesDead(name));
}

export async function listStacks(deps: StackDeps): Promise<StackRow[]> {
  const loadMap = deps.loadMap ?? loadProjectMap;
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const projects = listMappedProjects(loadMap(deps.projectsPath));
  return Promise.all(
    projects.map(async ({ name, path }): Promise<StackRow> => {
      const slug = statusSlug(name);
      const hasStack = isExecutable(join(path, "scripts", "start.sh"));
      return {
        project: name,
        slug,
        hasStack,
        status: hasStack ? await statusOf(slug, deps) : null,
        pullable: resolve(path) !== resolve(deps.selfPath),
      };
    }),
  );
}
```

Note: `startStackSession`/`tmuxKillSession` are imported now (used by Task 4) — TypeScript's `noUnusedLocals` is not enabled in this repo (they are re-exported through the default deps in Task 4); if `tsc` complains about an unused import at this task, defer the two imports to Task 4.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/projectStack.test.ts && npx tsc --noEmit`
Expected: PASS (all listStacks/resolveStack tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stacks.ts src/server/projectStack.ts tests/server/projectStack.test.ts
git commit -m "feat(server): projectStack listStacks/resolveStack with self-row + status (RIC-165)"
```

---

### Task 4: `startStack` + `stopStack`

**Files:**
- Modify: `src/server/projectStack.ts`
- Test: `tests/server/projectStack.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveStack`, `StackDeps`, `stackSessionName`, tmux `startStackSession`/`killSession`.
- Produces:
  ```ts
  export type StackActionResult =
    | { ok: true; status: StackStatus }
    | { ok: false; error: string; code: number };
  export function startStack(slug: string, deps: StackDeps): Promise<StackActionResult>;
  export function stopStack(slug: string, deps: StackDeps): Promise<StackActionResult>;
  ```
  `startStack`: 404 when unknown or `!hasStack`; 409 when already running; else runs `bash -lc 'scripts/start.sh'` and returns `running`.
  `stopStack`: 404 when unknown or `!hasStack`; 409 when not running; else kills the session and returns `stopped`.

- [ ] **Step 1: Write the failing test** — append to `tests/server/projectStack.test.ts`:

```ts
import { startStack, stopStack } from "@/server/projectStack";

describe("startStack", () => {
  it("404 when the project has no start.sh", async () => {
    const r = await startStack("lime", deps());
    expect(r).toEqual({ ok: false, error: "no stack", code: 404 });
  });
  it("404 for an unknown slug", async () => {
    expect(await startStack("nope", deps())).toEqual({ ok: false, error: "no stack", code: 404 });
  });
  it("409 when already running", async () => {
    const r = await startStack("factorybook", deps({ hasSession: async () => true }));
    expect(r).toEqual({ ok: false, error: "already running", code: 409 });
  });
  it("starts the stack and returns running", async () => {
    const calls: Array<[string, string, string]> = [];
    const r = await startStack("factorybook", deps({
      hasSession: async () => false,
      startSession: async (n, c, cmd) => { calls.push([n, c, cmd]); },
    }));
    expect(r).toEqual({ ok: true, status: "running" });
    expect(calls).toEqual([["stack-factorybook", "/repo/fb", "bash -lc 'scripts/start.sh'"]]);
  });
});

describe("stopStack", () => {
  it("409 when not running", async () => {
    expect(await stopStack("factorybook", deps({ hasSession: async () => false })))
      .toEqual({ ok: false, error: "not running", code: 409 });
  });
  it("kills the session and returns stopped", async () => {
    const killed: string[] = [];
    const r = await stopStack("factorybook", deps({
      hasSession: async () => true,
      killSession: async (n) => { killed.push(n); },
    }));
    expect(r).toEqual({ ok: true, status: "stopped" });
    expect(killed).toEqual(["stack-factorybook"]);
  });
  it("404 when the project has no start.sh", async () => {
    expect(await stopStack("lime", deps())).toEqual({ ok: false, error: "no stack", code: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/projectStack.test.ts`
Expected: FAIL — `startStack`/`stopStack` not exported.

- [ ] **Step 3: Implement** — append to `src/server/projectStack.ts`:

```ts
export type StackActionResult =
  | { ok: true; status: StackStatus }
  | { ok: false; error: string; code: number };

export async function startStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const startSession = deps.startSession ?? startStackSession;
  const name = stackSessionName(slug);
  if (await hasSession(name)) return { ok: false, error: "already running", code: 409 };
  await startSession(name, target.path, "bash -lc 'scripts/start.sh'");
  return { ok: true, status: "running" };
}

export async function stopStack(slug: string, deps: StackDeps): Promise<StackActionResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.hasStack) return { ok: false, error: "no stack", code: 404 };
  const hasSession = deps.hasSession ?? tmuxHasSession;
  const killSession = deps.killSession ?? tmuxKillSession;
  const name = stackSessionName(slug);
  if (!(await hasSession(name))) return { ok: false, error: "not running", code: 409 };
  await killSession(name);
  return { ok: true, status: "stopped" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/projectStack.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/projectStack.ts tests/server/projectStack.test.ts
git commit -m "feat(server): projectStack start/stop with 404/409 guards (RIC-165)"
```

---

### Task 5: `pullStack` (single-flight) + `currentBranch`

**Files:**
- Modify: `src/server/projectStack.ts`
- Test: `tests/server/projectStack.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveStack`, `ffPull`, `FfPullError`, `FfPullResult` (`@/server/ffPull`).
- Produces:
  ```ts
  export type StackPullResult =
    | { ok: true; result: FfPullResult }
    | { ok: false; error: string; code: number; detail?: string };
  export function pullStack(slug: string, deps: StackDeps): Promise<StackPullResult>;
  export function currentBranch(cwd: string, run?: GitRun): Promise<string>;
  export function _resetStackInflight(): void; // test hook
  ```
  `pullStack`: 404 when unknown or `!pullable`; on `ffPull` success `{ ok: true, result }`; on `FfPullError` maps `diverged`→409, `failed`→500 with `detail`. Single-flight per slug: concurrent calls for the same slug await one `ffPull`.
- Extends `StackDeps` with optional `pull?: (cwd: string) => Promise<FfPullResult>` (default `ffPull`).

- [ ] **Step 1: Write the failing test** — append to `tests/server/projectStack.test.ts`:

```ts
import { pullStack, _resetStackInflight } from "@/server/projectStack";
import { FfPullError, type FfPullResult } from "@/server/ffPull";
import { afterEach } from "vitest";

afterEach(() => _resetStackInflight());

describe("pullStack", () => {
  it("404 when the row is not pullable (Mojito self-row)", async () => {
    expect(await pullStack("mojito", deps())).toEqual({ ok: false, error: "not pullable", code: 404 });
  });
  it("404 for an unknown slug", async () => {
    expect(await pullStack("nope", deps())).toEqual({ ok: false, error: "not pullable", code: 404 });
  });
  it("returns the FfPullResult on success", async () => {
    const result: FfPullResult = { status: "updated", from: "aaa", to: "bbb" };
    expect(await pullStack("factorybook", deps({ pull: async () => result })))
      .toEqual({ ok: true, result });
  });
  it("maps diverged -> 409 and failed -> 500 with detail", async () => {
    const diverged = await pullStack("factorybook", deps({
      pull: async () => { throw new FfPullError("diverged", "Not possible to fast-forward"); },
    }));
    expect(diverged).toEqual({ ok: false, error: "diverged", code: 409, detail: "Not possible to fast-forward" });
    const failed = await pullStack("fb2-unused", deps({
      loadMap: () => ({ RIC: { projects: { Factorybook: "/repo/fb" } } }) as never,
      pull: async () => { throw new FfPullError("failed", "network down"); },
    }));
    // (slug "factorybook" is single-flighted; use the same slug after reset)
    _resetStackInflight();
    const failed2 = await pullStack("factorybook", deps({
      pull: async () => { throw new FfPullError("failed", "network down"); },
    }));
    expect(failed2).toEqual({ ok: false, error: "failed", code: 500, detail: "network down" });
  });
  it("single-flights concurrent pulls for the same slug", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({ pull: async () => { calls += 1; await gate; return { status: "up-to-date", from: "x", to: "x" }; } });
    const p1 = pullStack("factorybook", d);
    const p2 = pullStack("factorybook", d);
    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/projectStack.test.ts`
Expected: FAIL — `pullStack`/`_resetStackInflight` not exported.

- [ ] **Step 3: Implement** — in `src/server/projectStack.ts`: add `pull?` to `StackDeps`, add the imports, and append the code.

Add to the `StackDeps` interface:

```ts
  pull?: (cwd: string) => Promise<import("./ffPull.js").FfPullResult>;
```

Add near the top imports:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffPull, FfPullError, type FfPullResult, type GitRun } from "./ffPull.js";

const pexec = promisify(execFile);
```

Append:

```ts
export type StackPullResult =
  | { ok: true; result: FfPullResult }
  | { ok: false; error: string; code: number; detail?: string };

const pullInflight = new Map<string, Promise<FfPullResult>>();

export function _resetStackInflight(): void {
  pullInflight.clear();
}

export async function pullStack(slug: string, deps: StackDeps): Promise<StackPullResult> {
  const target = resolveStack(slug, deps);
  if (!target || !target.pullable) return { ok: false, error: "not pullable", code: 404 };
  const pull = deps.pull ?? ((cwd: string) => ffPull(cwd));
  try {
    let inflight = pullInflight.get(slug);
    if (!inflight) {
      inflight = (async () => {
        try {
          return await pull(target.path);
        } finally {
          pullInflight.delete(slug);
        }
      })();
      pullInflight.set(slug, inflight);
    }
    return { ok: true, result: await inflight };
  } catch (e) {
    if (e instanceof FfPullError) {
      return { ok: false, error: e.kind, code: e.kind === "diverged" ? 409 : 500, detail: e.detail };
    }
    return { ok: false, error: "failed", code: 500, detail: String(e) };
  }
}

export async function currentBranch(cwd: string, run: GitRun = (args, c) =>
  pexec("git", args, { cwd: c, timeout: 10_000, encoding: "utf8" })): Promise<string> {
  const { stdout } = await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return stdout.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/projectStack.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/projectStack.ts tests/server/projectStack.test.ts
git commit -m "feat(server): projectStack pullStack single-flight + currentBranch (RIC-165)"
```

---

### Task 6: `buildCustomClaudeCommand` optional prompt

**Files:**
- Modify: `src/server/launch.ts`
- Test: `tests/server/launch.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: existing `CustomLaunchRequest`, `buildCustomClaudeCommand`.
- Produces: `CustomLaunchRequest` gains `prompt?: string`; `buildCustomClaudeCommand` appends the prompt as a single quoted positional arg when present, and is byte-for-byte unchanged when absent.

- [ ] **Step 1: Write the failing test** — `tests/server/launch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCustomClaudeCommand } from "@/server/launch";

describe("buildCustomClaudeCommand prompt", () => {
  const base = { projectName: "Factorybook", model: "opus", effort: "high" as const };
  it("appends the prompt as a single quoted positional arg", () => {
    const cmd = buildCustomClaudeCommand({ ...base, prompt: "align the branch" }, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json' 'align the branch'");
  });
  it("is unchanged when no prompt is given", () => {
    const cmd = buildCustomClaudeCommand(base, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json'");
  });
  it("escapes single quotes in the prompt", () => {
    const cmd = buildCustomClaudeCommand({ ...base, prompt: "it's fine" }, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json' 'it'\\''s fine'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — prompt not appended (2nd/3rd assertions fail; TS error on `prompt`).

- [ ] **Step 3: Implement** — in `src/server/launch.ts`, add `prompt?: string;` to the `CustomLaunchRequest` interface, and change `buildCustomClaudeCommand`:

```ts
export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string, contextPath?: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const envPrefix = contextPath ? `LIME_SESSION_CONTEXT=${q(contextPath)} ` : "";
  const base = `${envPrefix}claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)}`;
  return req.prompt ? `${base} ${q(req.prompt)}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/launch.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(server): buildCustomClaudeCommand appends optional seeded prompt (RIC-165)"
```

---

### Task 7: `buildResolvePrompt` + `launchStackResolveSession`

**Files:**
- Modify: `src/server/launch.ts`
- Test: `tests/server/launch.test.ts` (extend)

**Interfaces:**
- Consumes: `defaultModelForStatus`, `defaultEffortForStatus` (`@/server/stageDefaults`); `loadProjectMap`, `resolvePathForProject` (`@/server/limeProjects`); `launchCustomSession`, `LaunchDeps`.
- Produces:
  - `buildResolvePrompt(project: string, repo: string, branch: string): string` — fixed template, server-derived values only.
  - `launchStackResolveSession(req: { projectName: string; branch: string }, deps: LaunchDeps & { genId?: () => string; homeDir?: () => string }): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }>` — reads To-Merge model/effort server-side and launches a project-scoped custom session seeded with the prompt.

- [ ] **Step 1: Write the failing test** — append to `tests/server/launch.test.ts`:

```ts
import { buildResolvePrompt, launchStackResolveSession } from "@/server/launch";
import { Registry } from "@/server/registry";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("buildResolvePrompt", () => {
  it("embeds only server-derived values (project, repo, branch)", () => {
    const p = buildResolvePrompt("Factorybook", "/repo/fb", "main");
    expect(p).toContain("Factorybook");
    expect(p).toContain("/repo/fb");
    expect(p).toContain("main");
    expect(p).toMatch(/fast-forward/i);
    expect(p).toMatch(/force-push/i); // instructs NOT to force-push
  });
});

describe("launchStackResolveSession", () => {
  it("launches a project-scoped custom session seeded with the resolve prompt", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mojito-launch-"));
    let command = "";
    const map = { RIC: { projects: { Factorybook: "/repo/fb" } } };
    const res = await launchStackResolveSession(
      { projectName: "Factorybook", branch: "feature/x" },
      {
        registry: new Registry(stateDir),
        stateDir, port: 4711, token: "t", projectsPath: "/ignored",
        hasSession: async () => false,
        newSession: async (_n, _c, cmd) => { command = cmd; },
        pipePane: async () => {},
        // resolveCwd is only used for ticket-scoped launches; project-scoped uses the map.
        // Override the map loader indirectly by pointing projectsPath at a file is avoided:
        // launchStackResolveSession resolves via resolvePathForProject(loadProjectMap(projectsPath)).
      } as never,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.kind).toBe("custom");
      expect(res.meta.projectName).toBe("Factorybook");
    }
    // Command carries the seeded prompt as the final quoted arg, and no client string.
    expect(command).toMatch(/claude --model .* --effort .* --settings .* '.*force-push.*'/s);
    void map;
  });
});
```

> Note for the implementer: `launchStackResolveSession` resolves the repo path from `loadProjectMap(deps.projectsPath)`. In the test above, point `projectsPath` at a temp `lime-projects.json` containing `{"RIC":{"projects":{"Factorybook":"/repo/fb"}}}` (write it with `writeFileSync` into `stateDir` and pass that path) OR accept that `resolvePathForProject` returns null and assert `{ ok: false, reason: "no-repo" }` — pick the pullable-path variant: write the temp map file and pass its path so the repo resolves. Adjust the test to write the map file and set `projectsPath` to it before asserting `res.ok === true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — `buildResolvePrompt`/`launchStackResolveSession` not exported.

- [ ] **Step 3: Implement** — in `src/server/launch.ts` add imports and functions:

Add imports (top of file):

```ts
import { defaultModelForStatus, defaultEffortForStatus } from "./stageDefaults.js";
import { loadProjectMap, resolvePathForProject } from "./limeProjects.js";
```

(If `loadProjectMap`/`resolvePathForProject` are already imported for `launchCustomSession`, do not duplicate.)

Append:

```ts
export function buildResolvePrompt(project: string, repo: string, branch: string): string {
  return [
    `You are in the git repository for the "${project}" project at ${repo} (branch ${branch}).`,
    `A fast-forward-only pull (\`git pull --ff-only\`) could NOT fast-forward: this branch and its`,
    `upstream on origin have diverged. Bring the branch up to date with origin without losing local`,
    `work and without force-pushing.`,
    ``,
    `Steps: fetch origin; inspect the divergence (git status, git log --oneline --graph); rebase or`,
    `merge as appropriate and resolve any conflicts; verify the working tree is clean and the branch`,
    `is current. Do not force-push. Do not discard local commits.`,
  ].join("\n");
}

export async function launchStackResolveSession(
  req: { projectName: string; branch: string },
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const repo = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
  if (!repo) return { ok: false, reason: "no-repo" };
  const model = defaultModelForStatus("To Merge");
  const effort = defaultEffortForStatus("To Merge");
  const prompt = buildResolvePrompt(req.projectName, repo, req.branch);
  return launchCustomSession({ projectName: req.projectName, model, effort, prompt }, deps);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/launch.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(server): launchStackResolveSession with server-seeded resolve prompt (RIC-165)"
```

---

### Task 8: `GET /api/stacks`

**Files:**
- Create: `src/app/api/stacks/route.ts`
- Test: `tests/server/stacksRoute.test.ts` (create)

**Interfaces:**
- Consumes: `getConfig` (`@/server/app`), `tokenFromHeaders` (`@/server/auth`), `listStacks` (`@/server/projectStack`).
- Produces: `GET` → 401 unauthorized | 200 `{ stacks: StackRow[] }`.

- [ ] **Step 1: Write the failing test** — `tests/server/stacksRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/projectStack", () => ({
  listStacks: vi.fn(),
  startStack: vi.fn(),
  stopStack: vi.fn(),
  pullStack: vi.fn(),
  resolveStack: vi.fn(),
  currentBranch: vi.fn(),
}));

import { GET } from "@/app/api/stacks/route";
import { listStacks } from "@/server/projectStack";

const TOKEN = "test-token";
function req(auth = true): Request {
  return new Request("http://localhost/api/stacks", { headers: auth ? { "x-mojito-token": TOKEN } : {} });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(listStacks).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/stacks", () => {
  it("401 without token", async () => {
    expect((await GET(req(false))).status).toBe(401);
  });
  it("200 with the stack rows", async () => {
    const rows = [{ project: "Factorybook", slug: "factorybook", hasStack: true, status: "stopped", pullable: true }];
    vi.mocked(listStacks).mockResolvedValue(rows as never);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stacks: rows });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stacksRoute.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement** — `src/app/api/stacks/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listStacks } from "@/server/projectStack";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const stacks = await listStacks({ projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  return NextResponse.json({ stacks });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stacksRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stacks/route.ts tests/server/stacksRoute.test.ts
git commit -m "feat(api): GET /api/stacks returns per-project stack rows (RIC-165)"
```

---

### Task 9: `POST /api/stacks/[slug]/start` and `/stop`

**Files:**
- Create: `src/app/api/stacks/[slug]/start/route.ts`
- Create: `src/app/api/stacks/[slug]/stop/route.ts`
- Test: `tests/server/stacksRoute.test.ts` (extend)

**Interfaces:**
- Consumes: `getConfig`, `tokenFromHeaders`, `startStack`/`stopStack` (returning `StackActionResult`).
- Produces: `POST` → 401 | 200 `{ status }` | 404 `{ error }` | 409 `{ error }`.

- [ ] **Step 1: Write the failing test** — append to `tests/server/stacksRoute.test.ts`:

```ts
import { POST as START } from "@/app/api/stacks/[slug]/start/route";
import { POST as STOP } from "@/app/api/stacks/[slug]/stop/route";
import { startStack, stopStack } from "@/server/projectStack";

function preq(slug: string, auth = true) {
  return {
    request: new Request(`http://localhost/api/stacks/${slug}/start`, {
      method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {},
    }),
    ctx: { params: Promise.resolve({ slug }) },
  };
}

describe("POST /api/stacks/[slug]/start", () => {
  it("401 without token", async () => {
    const { request, ctx } = preq("factorybook", false);
    expect((await START(request, ctx)).status).toBe(401);
  });
  it("200 with status on success", async () => {
    vi.mocked(startStack).mockResolvedValue({ ok: true, status: "running" });
    const { request, ctx } = preq("factorybook");
    const res = await START(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running" });
  });
  it("maps 404 / 409 from the result", async () => {
    vi.mocked(startStack).mockResolvedValue({ ok: false, error: "no stack", code: 404 });
    expect((await START(...Object.values(preq("lime")) as [Request, never])).status).toBe(404);
    vi.mocked(startStack).mockResolvedValue({ ok: false, error: "already running", code: 409 });
    const res = await START(...Object.values(preq("factorybook")) as [Request, never]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already running" });
  });
});

describe("POST /api/stacks/[slug]/stop", () => {
  it("200 with status on success", async () => {
    vi.mocked(stopStack).mockResolvedValue({ ok: true, status: "stopped" });
    const res = await STOP(...Object.values(preq("factorybook")) as [Request, never]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stopped" });
  });
  it("maps 409 not running", async () => {
    vi.mocked(stopStack).mockResolvedValue({ ok: false, error: "not running", code: 409 });
    expect((await STOP(...Object.values(preq("factorybook")) as [Request, never])).status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stacksRoute.test.ts`
Expected: FAIL — start/stop route modules do not exist.

- [ ] **Step 3: Implement** — `src/app/api/stacks/[slug]/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { startStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await startStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });
  return NextResponse.json({ status: r.status }, { status: 200 });
}
```

`src/app/api/stacks/[slug]/stop/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { stopStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await stopStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });
  return NextResponse.json({ status: r.status }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stacksRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stacks/[slug]/start/route.ts src/app/api/stacks/[slug]/stop/route.ts tests/server/stacksRoute.test.ts
git commit -m "feat(api): POST /api/stacks/[slug]/start|stop (RIC-165)"
```

---

### Task 10: `POST /api/stacks/[slug]/pull`

**Files:**
- Create: `src/app/api/stacks/[slug]/pull/route.ts`
- Test: `tests/server/stacksRoute.test.ts` (extend)

**Interfaces:**
- Consumes: `getConfig`, `tokenFromHeaders`, `pullStack` (returning `StackPullResult`).
- Produces: `POST` → 401 | 200 `{ status, from, to }` | 404 `{ error }` | 409 `{ error, detail }` | 500 `{ error, detail }`.

- [ ] **Step 1: Write the failing test** — append to `tests/server/stacksRoute.test.ts`:

```ts
import { POST as PULL } from "@/app/api/stacks/[slug]/pull/route";
import { pullStack } from "@/server/projectStack";

function pullReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/pull`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/pull", () => {
  it("200 returns the pull result at top level", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: true, result: { status: "updated", from: "a", to: "b" } });
    const res = await PULL(...pullReq("factorybook"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "updated", from: "a", to: "b" });
  });
  it("404 for the Mojito self-row", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "not pullable", code: 404 });
    expect((await PULL(...pullReq("mojito"))).status).toBe(404);
  });
  it("409 diverged with detail", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "diverged", code: 409, detail: "Not possible to fast-forward" });
    const res = await PULL(...pullReq("factorybook"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "diverged", detail: "Not possible to fast-forward" });
  });
  it("500 failed with detail", async () => {
    vi.mocked(pullStack).mockResolvedValue({ ok: false, error: "failed", code: 500, detail: "network down" });
    expect((await PULL(...pullReq("factorybook"))).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stacksRoute.test.ts`
Expected: FAIL — pull route module does not exist.

- [ ] **Step 3: Implement** — `src/app/api/stacks/[slug]/pull/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { pullStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await pullStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (r.ok) return NextResponse.json(r.result, { status: 200 });
  return NextResponse.json(r.detail ? { error: r.error, detail: r.detail } : { error: r.error }, { status: r.code });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stacksRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stacks/[slug]/pull/route.ts tests/server/stacksRoute.test.ts
git commit -m "feat(api): POST /api/stacks/[slug]/pull with ff-only + diverged/failed mapping (RIC-165)"
```

---

### Task 11: `POST /api/stacks/[slug]/resolve`

**Files:**
- Create: `src/app/api/stacks/[slug]/resolve/route.ts`
- Test: `tests/server/stacksRoute.test.ts` (extend)

**Interfaces:**
- Consumes: `getConfig`, `getRegistry` (`@/server/app`), `tokenFromHeaders`, `resolveStack` + `currentBranch` (`@/server/projectStack`), `launchStackResolveSession` (`@/server/launch`), `hasSession`/`newSession`/`pipePane` (`@/server/tmux`).
- Produces: `POST` → 401 | 404 (unknown slug or not pullable) | 201 `{ meta }` | 422 `{ error }` (no-repo).

- [ ] **Step 1: Write the failing test** — append to `tests/server/stacksRoute.test.ts` (extend the top `vi.mock("@/server/projectStack", …)` factory so it also mocks `resolveStack`/`currentBranch` — already included above — and add a launch mock):

```ts
vi.mock("@/server/launch", () => ({ launchStackResolveSession: vi.fn() }));

import { POST as RESOLVE } from "@/app/api/stacks/[slug]/resolve/route";
import { resolveStack, currentBranch } from "@/server/projectStack";
import { launchStackResolveSession } from "@/server/launch";

function resolveReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/resolve`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/resolve", () => {
  it("404 when the row is unknown or not pullable", async () => {
    vi.mocked(resolveStack).mockReturnValue(null);
    expect((await RESOLVE(...resolveReq("nope"))).status).toBe(404);
    vi.mocked(resolveStack).mockReturnValue({ project: "Mojito", path: "/repo/mojito", hasStack: false, pullable: false });
    expect((await RESOLVE(...resolveReq("mojito"))).status).toBe(404);
  });
  it("201 with meta on success", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true });
    vi.mocked(currentBranch).mockResolvedValue("main");
    vi.mocked(launchStackResolveSession).mockResolvedValue({ ok: true, meta: { id: "mojito-custom-factorybook-abc", kind: "custom" } as never });
    const res = await RESOLVE(...resolveReq("factorybook"));
    expect(res.status).toBe(201);
    expect((await res.json()).meta.id).toBe("mojito-custom-factorybook-abc");
    expect(vi.mocked(launchStackResolveSession).mock.calls[0][0]).toEqual({ projectName: "Factorybook", branch: "main" });
  });
  it("422 when the repo cannot be resolved", async () => {
    vi.mocked(resolveStack).mockReturnValue({ project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true });
    vi.mocked(currentBranch).mockResolvedValue("main");
    vi.mocked(launchStackResolveSession).mockResolvedValue({ ok: false, reason: "no-repo" });
    expect((await RESOLVE(...resolveReq("factorybook"))).status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stacksRoute.test.ts`
Expected: FAIL — resolve route module does not exist.

- [ ] **Step 3: Implement** — `src/app/api/stacks/[slug]/resolve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveStack, currentBranch } from "@/server/projectStack";
import { launchStackResolveSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const target = resolveStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!target || !target.pullable) return new NextResponse("not found", { status: 404 });
  const branch = await currentBranch(target.path);
  const res = await launchStackResolveSession(
    { projectName: target.project, branch },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json({ meta: res.meta }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stacksRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stacks/[slug]/resolve/route.ts tests/server/stacksRoute.test.ts
git commit -m "feat(api): POST /api/stacks/[slug]/resolve launches a To-Merge Claude session (RIC-165)"
```

---

### Task 12: Client lib — `src/lib/stacks.ts` helpers + `useStacks` hook

**Files:**
- Modify: `src/lib/stacks.ts` (add pure helpers to the types from Task 3)
- Create: `src/lib/useStacks.ts`
- Test: `tests/lib/stacks.test.ts` (create)

**Interfaces:**
- Produces (pure, tested):
  - `pullMessage(res: PullResponse): { kind: "ok" | "err"; text: string; canResolve: boolean }` — interprets a `/pull` JSON body into UI text, mirroring `SettingsSheet.onPull`. `PullResponse = { status: "updated" | "up-to-date"; from: string; to: string } | { error: string; detail?: string }`.
  - `syntheticStackSession(slug: string, project: string): SessionMeta` — a minimal `SessionMeta` whose `id` is `stack-<slug>`, for opening logs in `TerminalView` (only `id` drives the WS; other fields fill the header).
- Produces (thin, untested): `useStacks(token: string)` — `{ stacks, refresh }`, light-polls `GET /api/stacks` every 5s (mirrors `useTickets`).

- [ ] **Step 1: Write the failing test** — `tests/lib/stacks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pullMessage, syntheticStackSession } from "@/lib/stacks";

describe("pullMessage", () => {
  it("updated -> ok with from/to", () => {
    expect(pullMessage({ status: "updated", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Updated aaa → bbb.", canResolve: false });
  });
  it("up-to-date -> ok", () => {
    expect(pullMessage({ status: "up-to-date", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Already up to date (aaa).", canResolve: false });
  });
  it("diverged -> err offering resolve", () => {
    const m = pullMessage({ error: "diverged", detail: "Not possible to fast-forward" });
    expect(m.kind).toBe("err");
    expect(m.canResolve).toBe(true);
    expect(m.text).toMatch(/diverged/i);
  });
  it("failed -> err offering resolve", () => {
    expect(pullMessage({ error: "failed", detail: "network down" }).canResolve).toBe(true);
  });
});

describe("syntheticStackSession", () => {
  it("builds a SessionMeta whose id is the stack tmux name", () => {
    const s = syntheticStackSession("factorybook", "Factorybook");
    expect(s.id).toBe("stack-factorybook");
    expect(s.kind).toBe("custom");
    expect(s.title).toContain("Factorybook");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/stacks.test.ts`
Expected: FAIL — `pullMessage`/`syntheticStackSession` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/stacks.ts`:

```ts
import type { SessionMeta } from "@/server/types";

export type PullResponse =
  | { status: "updated" | "up-to-date"; from: string; to: string }
  | { error: string; detail?: string };

export function pullMessage(res: PullResponse): { kind: "ok" | "err"; text: string; canResolve: boolean } {
  if ("status" in res) {
    return res.status === "updated"
      ? { kind: "ok", text: `Updated ${res.from} → ${res.to}.`, canResolve: false }
      : { kind: "ok", text: `Already up to date (${res.from}).`, canResolve: false };
  }
  const base = res.error === "diverged" ? "History diverged" : "Pull failed";
  const text = res.detail ? `${base} — ${res.detail}` : base;
  return { kind: "err", text, canResolve: true };
}

export function syntheticStackSession(slug: string, project: string): SessionMeta {
  return {
    kind: "custom",
    id: `stack-${slug}`,
    ticket: "",
    launchStatus: "",
    model: "",
    effort: "",
    autoAdvance: false,
    state: "running",
    cwd: "",
    createdAt: "",
    projectName: project,
    title: `${project} · stack logs`,
    labels: [],
  };
}
```

> Note: importing `SessionMeta` type from `@/server/types` is a type-only import (erased at build); it does not pull server code into the client bundle. If the project's lint forbids server imports from lib, define a local structural type instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/stacks.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Create the hook** — `src/lib/useStacks.ts` (thin; mirrors `useTickets`):

```ts
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { StackRow } from "@/lib/stacks";

export function useStacks(token: string) {
  const [stacks, setStacks] = useState<StackRow[]>([]);
  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(token, "/api/stacks");
      if (res.ok) setStacks((await res.json()).stacks ?? []);
    } catch {
      /* transient; next tick retries */
    }
  }, [token]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  return { stacks, refresh };
}
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run tests/lib/stacks.test.ts`
Expected: tsc clean, tests PASS.

```bash
git add src/lib/stacks.ts src/lib/useStacks.ts tests/lib/stacks.test.ts
git commit -m "feat(ui): stacks lib helpers (pullMessage, synthetic session) + useStacks hook (RIC-165)"
```

---

### Task 13: `StacksPanel` component + `page.tsx` wiring

**Files:**
- Create: `src/components/StacksPanel.tsx`
- Modify: `src/app/page.tsx`
- (No new unit test — see the note; verification is `tsc` + running the app.)

**Interfaces:**
- Consumes: `useStacks`, `apiFetch`, `pullMessage`, `syntheticStackSession`, `StackRow`, `StateBadge` (for the dot), `TerminalView` open callback from `page.tsx`.
- Produces: `<StacksPanel token onOpenLogs={(s: SessionMeta) => void} />` — one row per `StackRow` with: a status dot + label (when `hasStack`), start/stop button (calls `/start`|`/stop`, then `refresh`), a **Logs** button (calls `onOpenLogs(syntheticStackSession(slug, project))`), and — only when `row.pullable` — a **Pull** button that POSTs `/pull`, runs `pullMessage`, and when `canResolve` shows a "Resolve with Claude" button that POSTs `/resolve` and opens the returned session.

> **Testing note (repo convention):** there is no React test runner (node env, no testing-library). All branching logic is already unit-tested in `src/lib/stacks.ts`. This task's component is a thin view over that logic; it is verified by `npx tsc --noEmit` and by running the app (below). Keep the component free of untested branching — delegate any new decision to a pure `src/lib/stacks.ts` helper with its own test.

- [ ] **Step 1: Implement the panel** — `src/components/StacksPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useStacks } from "@/lib/useStacks";
import { pullMessage, syntheticStackSession, type PullResponse, type StackRow } from "@/lib/stacks";
import type { SessionMeta } from "@/server/types";

export default function StacksPanel({ token, onOpenLogs }: { token: string; onOpenLogs: (s: SessionMeta) => void }) {
  const { stacks, refresh } = useStacks(token);
  return (
    <div className="pad">
      <section>
        <h4 className="sect">Stacks</h4>
        {stacks.map((row) => (
          <StackRowView key={row.slug} row={row} token={token} onOpenLogs={onOpenLogs} refresh={refresh} />
        ))}
      </section>
    </div>
  );
}

function StackRowView({ row, token, onOpenLogs, refresh }: {
  row: StackRow; token: string; onOpenLogs: (s: SessionMeta) => void; refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; canResolve: boolean } | null>(null);

  const act = async (path: string) => {
    setBusy(true);
    try { await apiFetch(token, `/api/stacks/${row.slug}/${path}`, { method: "POST" }); await refresh(); }
    finally { setBusy(false); }
  };
  const pull = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/pull`, { method: "POST" });
      setMsg(pullMessage((await res.json()) as PullResponse));
      await refresh();
    } finally { setBusy(false); }
  };
  const resolve = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/resolve`, { method: "POST" });
      if (res.ok) onOpenLogs((await res.json()).meta as SessionMeta);
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="s-row">
        <span className={`s-dot ${row.status ?? ""}`} />
        <strong>{row.project}</strong>
        {row.hasStack && <span className="substatus">{row.status}</span>}
      </div>
      <div className="s-actions">
        {row.hasStack && row.status !== "running" && (
          <button className="btn sm" disabled={busy} onClick={() => act("start")}>Start</button>
        )}
        {row.hasStack && row.status === "running" && (
          <button className="btn sm" disabled={busy} onClick={() => act("stop")}>Stop</button>
        )}
        {row.hasStack && (
          <button className="btn sm ghost" onClick={() => onOpenLogs(syntheticStackSession(row.slug, row.project))}>Logs</button>
        )}
        {row.pullable && (
          <button className="btn sm ghost" disabled={busy} onClick={pull}>Pull</button>
        )}
      </div>
      {msg && <p className={msg.kind === "err" ? "err-text" : "sheet-title"}>{msg.text}</p>}
      {msg?.canResolve && (
        <button className="btn sm primary" disabled={busy} onClick={resolve}>Resolve with Claude</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the `.s-dot` status colors** — append to `src/app/globals.css` (reuse the existing `.s-dot` base; add stack-status modifiers):

```css
.s-dot.running { background: var(--ok, #3fb950); }
.s-dot.stopped { background: var(--muted, #6e7681); }
.s-dot.crashed { background: var(--danger, #f85149); }
.s-row { display: flex; align-items: center; gap: 8px; }
.s-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
```

(If any of these class names already exist in `globals.css`, keep the existing rule and only add the missing modifiers.)

- [ ] **Step 3: Wire the tab into `page.tsx`** — in `src/app/page.tsx`:
  1. Import: `import StacksPanel from "@/components/StacksPanel";` and (if not present) `dynamic`/`SessionMeta` are already imported.
  2. The tab body ternary is keyed on `tab` (`"tickets"` | `"sessions"`). Extend it to a third value `"stacks"`:

```tsx
{tab === "tickets" ? (
  <TicketList /* existing props */ />
) : tab === "stacks" ? (
  <StacksPanel token={token} onOpenLogs={(s) => setOpen(s)} />
) : (
  <SessionList /* existing props */ />
)}
```

  3. Add a nav button next to the existing ones:

```tsx
<button className={`tab ${tab === "stacks" ? "on" : ""}`} onClick={() => setTab("stacks")}>Stacks</button>
```

  Opening logs reuses the existing `open`/`TerminalView` path: `setOpen(syntheticStackSession(...))` points `TerminalView` at `/ws/pty?session=stack-<slug>`, which `attachPty` serves via `tmux attach-session` — no server change needed.

- [ ] **Step 4: Verify (tsc + build + run)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite PASS (no regressions).

Then confirm the panel renders and works against a real server (use the `run` skill or the project's dev command): open the UI, switch to the **Stacks** tab, verify every mapped project appears; a project with an executable `scripts/start.sh` shows Start/Stop/Logs and a status dot; the **Mojito** row shows **no Pull** button; a pull-only project shows only Pull; Start launches the `stack-<slug>` session and Logs opens its output in the web terminal.

- [ ] **Step 5: Commit**

```bash
git add src/components/StacksPanel.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat(ui): Stacks panel with start/stop/logs/pull/resolve (RIC-165)"
```

---

## Self-Review

**1. Spec coverage** (spec section → task):
- Contract (`scripts/start.sh`, no `stop.sh`) → Task 4 (`bash -lc 'scripts/start.sh'`, stop = kill).
- Server module `projectStack.ts` (`listStacks`, `startStack`, `stopStack`, status none/live/dead, `stack-` prefix, slug sanitized, execFile-only) → Tasks 1–5.
- tmux `remain-on-exit` window-scoped + crashed detection → Task 2.
- API GET/start/stop/pull/resolve with 401/404/409/500 and shapes → Tasks 8–11.
- `GET` `pullable` field + Mojito self-row not pullable (`/pull` → 404) → Tasks 3 (`pullable`), 10 (404), covered in tests.
- Pull reuses shared `ffPull`; only per-slug single-flight local → Task 5.
- Resolve session (project-scoped custom, To-Merge model/effort, server-seeded prompt, no client string, `buildCustomClaudeCommand` optional prompt, 201 `{ meta }`) → Tasks 6, 7, 11.
- UI panel (row per project, status dot, start/stop/logs, Pull except Mojito, resolve proposal, status on load via light poll) → Tasks 12, 13.
- Testing section (projectStack tests incl. `pullable`; pull wrapper single-flight + response mapping; launchStackResolveSession; route tests incl. Mojito `/pull` 404) → Tasks 3–5, 7, 8–11.
- Adoption note (Factorybook/GestionaleCooperativeMvp `start.sh`) → explicitly out-of-plan (separate repos), flagged in the header.
- Out-of-scope items (per-branch stacks, single-app control, auto-restart, unattended merge, log persistence) → not implemented, consistent.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The one soft spot is Task 7's test note about writing a temp `lime-projects.json`; the note gives the exact JSON and the two concrete assertion variants, so it is actionable, not a placeholder. Task 13 legitimately has no unit test (documented repo constraint) and substitutes `tsc` + app-run verification.

**3. Type consistency:** `StackStatus`/`StackRow` defined once in `src/lib/stacks.ts` (Task 3), imported everywhere. `StackActionResult` (Task 4), `StackPullResult` (Task 5), `StackDeps` (Tasks 3–5, extended additively). `pullable`/`hasStack`/`status` names match across server, routes, lib, and tests. `buildCustomClaudeCommand`/`launchCustomSession`/`launchStackResolveSession` signatures match the verified `launch.ts`. Route handler signature `{ params: Promise<{ slug: string }> }` is consistent across Tasks 9–11 and their tests pass `Promise.resolve({ slug })`.

**Known residual risk (documented, not a gap):** Task 2 sets `remain-on-exit` in the same tmux invocation as `new-session` to avoid the "set too late" race; extremely fast crashes on shells that ignore the chained `set-option` remain a theoretical edge, acceptable per the spec ("set right after creating the session").
