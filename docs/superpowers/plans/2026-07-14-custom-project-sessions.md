# Custom Project Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user launch a plain `claude` session scoped to a mapped project's folder (or the home directory) from the Mojito UI, tracked like any other session.

**Architecture:** A new `kind: "lime" | "custom"` discriminator on `SessionMeta`. Custom sessions run bare `claude` (no `/lime-next`, no launch context, no lifecycle) via a new `launchCustomSession`. Projects come from `~/.claude/lime-projects.json`. State tracking reuses the existing hook plumbing; the card label is patched from the hook payload's `session_title`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Node built-ins (`node:fs`, `node:os`, `node:crypto`, `node:path`), Vitest.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Mojito-only change. Do NOT touch the lime repo or the shared launch-context/status contract.
- Tests live under `tests/server/`; run the full gate with `npx tsc --noEmit && npx vitest run`.
- Custom sessions: no `/lime-next`, no launch-context sidecar, no auto-advance, no Linear call.
- Preserve backward compatibility: sidecars written before this change omit `kind` and must load as `"lime"`.
- Run every command from the worktree root `/Users/ricventu/code/Lime/mojito/.worktrees/ricventu/ric-115-sessione-custom-per-progetto`.

---

### Task 1: Add `kind` discriminator + backward-compatible hydration

**Files:**
- Modify: `src/server/types.ts` (add `kind` to `SessionMeta`)
- Modify: `src/server/sidecar.ts:21-27` (`readSidecar` defaults missing `kind`)
- Modify: `src/server/launch.ts:88-101` (stamp `kind: "lime"` on the lime meta)
- Test: `tests/server/sidecar.test.ts`, `tests/server/launch.test.ts`

**Interfaces:**
- Produces: `SessionMeta.kind: "lime" | "custom"` — consumed by every later task.

- [ ] **Step 1: Write the failing test (sidecar default)**

Add to `tests/server/sidecar.test.ts`:

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

it("defaults a missing kind to lime when reading a legacy sidecar", () => {
  const sdir = join(dir, "sessions");
  mkdirSync(sdir, { recursive: true });
  // legacy sidecar: no `kind` field
  writeFileSync(join(sdir, "mojito-RIC-1-to-code.json"), JSON.stringify({
    id: "mojito-RIC-1-to-code", ticket: "RIC-1", launchStatus: "To Code", model: "opus",
    effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "t", labels: [],
  }));
  expect(readSidecar(dir, "mojito-RIC-1-to-code")?.kind).toBe("lime");
});

it("preserves an explicit kind", () => {
  const sdir = join(dir, "sessions");
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, "mojito-custom-general-abc.json"), JSON.stringify({
    kind: "custom", id: "mojito-custom-general-abc", ticket: "", launchStatus: "", model: "opus",
    effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "home", labels: [],
  }));
  expect(readSidecar(dir, "mojito-custom-general-abc")?.kind).toBe("custom");
});
```

Ensure the test file's imports include `readSidecar` and that `dir` is created in `beforeEach` (match the existing file; if `dir` isn't already set up, add `let dir: string; beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/sidecar.test.ts`
Expected: FAIL — `kind` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add `kind` to `SessionMeta`**

In `src/server/types.ts`, add as the first field of `SessionMeta`:

```ts
export interface SessionMeta {
  kind: "lime" | "custom"; // "lime" = ticket-lifecycle session; "custom" = standalone claude session
  id: string;            // tmux session name, e.g. "mojito-RIC-46-to-review"
  ticket: string;        // "RIC-46" (empty for custom sessions)
  launchStatus: string;  // Linear status name at launch (empty for custom sessions)
  // ...rest unchanged
```

- [ ] **Step 4: Default `kind` in `readSidecar`**

In `src/server/sidecar.ts`, change `readSidecar`:

```ts
export function readSidecar(stateDir: string, id: string): SessionMeta | null {
  try {
    const meta = JSON.parse(readFileSync(join(sessionsDir(stateDir), `${id}.json`), "utf8")) as SessionMeta;
    // Sidecars written before `kind` existed default to the original lime behavior.
    return { kind: "lime", ...meta };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Stamp `kind` on the lime launch meta**

In `src/server/launch.ts`, in the `meta` object inside `launchSession` (currently starting `const meta: SessionMeta = { id,`), add `kind: "lime",` as the first property:

```ts
  const meta: SessionMeta = {
    kind: "lime",
    id,
    ticket: req.ticket,
    // ...rest unchanged
```

- [ ] **Step 6: Add a lime-meta assertion**

In `tests/server/launch.test.ts`, inside the existing successful-launch test (the one asserting `res.ok` and the meta), add:

```ts
expect((res as { ok: true; meta: { kind: string } }).meta.kind).toBe("lime");
```

If no such assertion block exists, add a focused test:

```ts
it("stamps kind lime on a launched session", async () => {
  const res = await launchSession(baseReq, deps());
  expect(res.ok).toBe(true);
  expect((res as { ok: true; meta: { kind: string } }).meta.kind).toBe("lime");
});
```

- [ ] **Step 7: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all suites, including the new sidecar and launch assertions).

- [ ] **Step 8: Commit**

```bash
git add src/server/types.ts src/server/sidecar.ts src/server/launch.ts tests/server/sidecar.test.ts tests/server/launch.test.ts
git commit -m "feat(mojito): add kind discriminator to SessionMeta (RIC-115)"
```

---

### Task 2: `customSessionName` helper

**Files:**
- Modify: `src/server/sessionKey.ts` (append `customSessionName`)
- Test: `tests/server/sessionKey.test.ts`

**Interfaces:**
- Consumes: `statusSlug` (existing, same file).
- Produces: `customSessionName(slug: string, unique: string): string` → `mojito-custom-${slug}-${unique}`.

- [ ] **Step 1: Write the failing test**

Add to `tests/server/sessionKey.test.ts` (import `customSessionName` alongside the existing imports):

```ts
import { customSessionName } from "@/server/sessionKey";

describe("customSessionName", () => {
  it("builds a prefixed name from slug and unique id", () => {
    expect(customSessionName("mojito", "a1b2c3")).toBe("mojito-custom-mojito-a1b2c3");
  });
  it("uses the general slug form", () => {
    expect(customSessionName("general", "ffffff")).toBe("mojito-custom-general-ffffff");
  });
  it("distinct unique ids yield distinct names", () => {
    expect(customSessionName("x", "aaa")).not.toBe(customSessionName("x", "bbb"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — `customSessionName is not a function`.

- [ ] **Step 3: Implement**

Append to `src/server/sessionKey.ts`:

```ts
export function customSessionName(slug: string, unique: string): string {
  return `mojito-custom-${slug}-${unique}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/sessionKey.ts tests/server/sessionKey.test.ts
git commit -m "feat(mojito): add customSessionName helper (RIC-115)"
```

---

### Task 3: List and resolve mapped projects

**Files:**
- Modify: `src/server/limeProjects.ts` (add two exports)
- Test: `tests/server/limeProjects.test.ts`

**Interfaces:**
- Consumes: `ProjectMap` (existing, same file).
- Produces:
  - `listMappedProjects(map: ProjectMap): { name: string; path: string }[]`
  - `resolvePathForProject(map: ProjectMap, name: string): string | null`

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/limeProjects.test.ts` (import the new functions):

```ts
import { listMappedProjects, resolvePathForProject } from "@/server/limeProjects";

describe("listMappedProjects", () => {
  const map = {
    ENG: "/code/backend",
    WEB: { path: "/code/web", projects: { "Design System": "/code/ds", "Marketing": "/code/mkt" } },
    OPS: { path: "/code/ops" },
  };
  it("flattens string, object-with-projects, and path-only entries, sorted by name", () => {
    expect(listMappedProjects(map)).toEqual([
      { name: "Design System", path: "/code/ds" },
      { name: "ENG", path: "/code/backend" },
      { name: "Marketing", path: "/code/mkt" },
      { name: "OPS", path: "/code/ops" },
    ]);
  });
  it("returns an empty array for an empty map", () => {
    expect(listMappedProjects({})).toEqual([]);
  });
});

describe("resolvePathForProject", () => {
  const map = { WEB: { path: "/code/web", projects: { "Design System": "/code/ds" } } };
  it("resolves a named project", () => {
    expect(resolvePathForProject(map, "Design System")).toBe("/code/ds");
  });
  it("returns null for an unmapped name", () => {
    expect(resolvePathForProject(map, "Nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/limeProjects.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `src/server/limeProjects.ts`:

```ts
export function listMappedProjects(map: ProjectMap): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry === "string") {
      out.push({ name: key, path: entry });
    } else if (entry.projects && Object.keys(entry.projects).length > 0) {
      for (const [name, path] of Object.entries(entry.projects)) out.push({ name, path });
    } else if (entry.path) {
      out.push({ name: key, path: entry.path });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolvePathForProject(map: ProjectMap, name: string): string | null {
  return listMappedProjects(map).find((p) => p.name === name)?.path ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/limeProjects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/limeProjects.ts tests/server/limeProjects.test.ts
git commit -m "feat(mojito): list and resolve mapped projects (RIC-115)"
```

---

### Task 4: `launchCustomSession` + `buildCustomClaudeCommand`

**Files:**
- Modify: `src/server/launch.ts` (add imports + two exports)
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `LaunchDeps` (existing), `buildHookSettings`, `logfilePath`, `loadProjectMap`, `resolvePathForProject`, `statusSlug`, `customSessionName`.
- Produces:
  - `CustomLaunchRequest { projectName: string | null; model: string; effort: Effort }`
  - `buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string): string`
  - `launchCustomSession(req, deps): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }>` where `deps: LaunchDeps & { genId?: () => string; homeDir?: () => string }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/launch.test.ts`:

```ts
import { launchCustomSession, buildCustomClaudeCommand } from "@/server/launch";
import { existsSync, writeFileSync } from "node:fs";

function customDeps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token",
    projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    nowIso: () => "2026-07-11T00:00:00.000Z",
    genId: () => "abc123",
    homeDir: () => "/home/me",
    ...over,
  };
}

describe("buildCustomClaudeCommand", () => {
  it("builds a bare claude command with no slash command", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" }, "/s/x.json");
    expect(cmd).toBe("claude --model 'opus' --effort 'high' --settings '/s/x.json'");
    expect(cmd).not.toContain("/lime-next");
  });
});

describe("launchCustomSession", () => {
  it("General opens in the home directory with a home label", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-general-abc123", ticket: "",
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home", autoAdvance: false });
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-general-abc123", "/home/me",
      expect.stringContaining("claude --model 'opus'"));
  });

  it("a mapped project opens in its folder with the basename label", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchCustomSession({ projectName: "Mojito", model: "sonnet", effort: "low" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-mojito-abc123",
      cwd: "/code/Lime/mojito", projectName: "Mojito", title: "mojito" });
  });

  it("writes hook settings but NO launch-context file", async () => {
    const d = customDeps();
    await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    expect(existsSync(join(dir, "settings", "mojito-custom-general-abc123.json"))).toBe(true);
    expect(existsSync(join(dir, "context", "mojito-custom-general-abc123.json"))).toBe(false);
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: "Ghost", model: "opus", effort: "high" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("registers the session in the registry", async () => {
    const d = customDeps();
    const res = await launchCustomSession({ projectName: null, model: "opus", effort: "high" }, d);
    const id = (res as { ok: true; meta: SessionMeta }).meta.id;
    expect(d.registry.get(id)?.kind).toBe("custom");
  });
});
```

Note: `writeLaunchContext` (`src/server/launchContext.ts`) writes to `<stateDir>/context/<id>.json`; the "NO launch-context file" assertion above checks that exact path stays absent for custom sessions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — `launchCustomSession`/`buildCustomClaudeCommand` not exported.

- [ ] **Step 3: Add imports to `launch.ts`**

At the top of `src/server/launch.ts`, extend/adjust imports:

```ts
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { tmuxName, parseIdentifier, validateTicket, statusSlug, customSessionName } from "./sessionKey.js";
import { loadProjectMap, resolveRepoFromMap, resolvePathForProject } from "./limeProjects.js";
```

(Keep all other existing imports; only `basename`, `homedir`, `randomBytes`, `statusSlug`, `customSessionName`, and `resolvePathForProject` are added.)

- [ ] **Step 4: Implement the command builder and launcher**

Append to `src/server/launch.ts`:

```ts
export interface CustomLaunchRequest {
  projectName: string | null;
  model: string;
  effort: Effort;
}

export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)}`;
}

export async function launchCustomSession(
  req: CustomLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));

  let cwd: string;
  if (req.projectName) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
    if (!path) return { ok: false, reason: "no-repo" };
    cwd = path;
  } else {
    cwd = homeDir();
  }

  const slug = req.projectName ? statusSlug(req.projectName) : "general";
  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  // No launch-context file: custom sessions run bare `claude`, not /lime-next.
  const command = buildCustomClaudeCommand(req, settingsPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "custom",
    id,
    ticket: "",
    launchStatus: "",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
    state: "starting",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title,
    labels: [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
```

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(mojito): launchCustomSession for standalone claude sessions (RIC-115)"
```

---

### Task 5: Hook handler custom branch + `session_title` label

**Files:**
- Modify: `src/server/hookHandler.ts` (add `payload` param + custom branch)
- Modify: `src/app/api/hook/route.ts:18-25` (parse body, forward `session_title`)
- Test: `tests/server/hookHandler.test.ts`

**Interfaces:**
- Consumes: `mapHook`, `Registry`, `EventBus`, `SessionMeta.kind`.
- Produces: `handleHook(id, event, deps, payload?: { sessionTitle?: string })` — new optional 4th arg.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/hookHandler.test.ts`:

```ts
function seedCustom(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  registry.upsert({ kind: "custom", id: "mojito-custom-general-abc", ticket: "", launchStatus: "",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/home/me",
    createdAt: "2026-07-11T00:00:00.000Z", title: "home", labels: [], ...over });
  return registry;
}

describe("handleHook — custom sessions", () => {
  it("patches the title from session_title without calling Linear", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "unused");
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} },
      { sessionTitle: "refactor auth flow" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("refactor auth flow");
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("running");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("SessionEnd on a custom session is done, not failed", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, getIssueStatus: vi.fn(async () => "x"), onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("done");
  });

  it("never auto-advances a custom session", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, getIssueStatus: vi.fn(async () => "x"), onAutoAdvance });
    expect(onAutoAdvance).not.toHaveBeenCalled();
  });

  it("keeps an empty session_title from clobbering the fallback label", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, getIssueStatus: vi.fn(async () => "x"), onAutoAdvance: () => {} },
      { sessionTitle: "" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
  });
});

it("does not overwrite a lime session's title", async () => {
  const { registry } = seed({ title: "Linear title" });
  const bus = new EventBus();
  await handleHook("mojito-RIC-46-to-code", "SessionStart",
    { registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {} },
    { sessionTitle: "should be ignored" });
  expect(registry.get("mojito-RIC-46-to-code")?.title).toBe("Linear title");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/hookHandler.test.ts`
Expected: FAIL — custom title not patched / SessionEnd is "failed" / arity mismatch.

- [ ] **Step 3: Implement the custom branch**

In `src/server/hookHandler.ts`, change the signature and add the branch right after the `if (!meta) return;` guard. Also import `SessionMeta` is already imported.

```ts
export async function handleHook(
  id: string,
  event: HookEventName,
  deps: HookDeps,
  payload?: { sessionTitle?: string },
): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta) return;

  if (meta.kind === "custom") {
    // Custom sessions have no ticket or lifecycle: never call Linear, never auto-advance.
    // SessionEnd is a clean close (done), not a failure.
    const outcome = event === "SessionEnd"
      ? { state: "done" as const, alert: null }
      : mapHook(event, false);
    const patch: Partial<SessionMeta> = { state: outcome.state, message: outcome.alert?.message };
    const title = payload?.sessionTitle;
    if (typeof title === "string" && title.length > 0 && title !== meta.title) patch.title = title;
    deps.registry.patch(id, patch);
    deps.bus.emit({ type: "session.state", id, state: outcome.state });
    if (outcome.alert) {
      deps.bus.emit({ type: "session.alert", id, kind: outcome.alert.kind, ticket: "", message: outcome.alert.message });
    }
    return;
  }

  // ...existing lime logic below, unchanged
```

Leave the rest of the function (the lime path: `statusAdvanced`, `getIssueStatus`, `mapHook`, patch, emit, auto-advance) exactly as it is.

- [ ] **Step 4: Forward `session_title` from the hook route**

In `src/app/api/hook/route.ts`, replace the body-drain line and the `handleHook` call:

```ts
  const raw = await req.text(); // forwarded hook payload (JSON on stdin from Claude Code)
  let payload: { sessionTitle?: string } | undefined;
  try {
    const json = JSON.parse(raw) as { session_title?: unknown };
    if (typeof json.session_title === "string") payload = { sessionTitle: json.session_title };
  } catch {
    /* non-JSON or empty body — no title to forward */
  }
  await handleHook(id, event, {
    registry: getRegistry(),
    bus: getBus(),
    getIssueStatus: (ticket) => getIssueStatus(cfg.linearApiKey, ticket),
    onAutoAdvance: (meta, newStatus) => void runAutoAdvance(meta, newStatus),
  }, payload);
```

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/hookHandler.ts src/app/api/hook/route.ts tests/server/hookHandler.test.ts
git commit -m "feat(mojito): track custom sessions and label from session_title (RIC-115)"
```

---

### Task 6: API — projects list + custom launch branch

**Files:**
- Create: `src/app/api/projects/route.ts`
- Modify: `src/app/api/sessions/route.ts` (branch `POST` on `kind`)

**Interfaces:**
- Consumes: `listMappedProjects`, `loadProjectMap`, `launchCustomSession`, `tokenFromHeaders`, `getConfig`, `getRegistry`.
- Produces: `GET /api/projects` → `{ projects: string[] }`; `POST /api/sessions` accepts `{ kind: "custom", projectName, model, effort }`.

- [ ] **Step 1: Create the projects route**

Create `src/app/api/projects/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { loadProjectMap, listMappedProjects } from "@/server/limeProjects";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const projects = listMappedProjects(loadProjectMap(cfg.projectsPath)).map((p) => p.name);
  return NextResponse.json({ projects });
}
```

- [ ] **Step 2: Branch the sessions POST on `kind`**

In `src/app/api/sessions/route.ts`, add `launchCustomSession` to the import from `@/server/launch`, then insert the custom branch immediately after `body` is parsed (before the existing `launchSession` call):

```ts
  if (body.kind === "custom") {
    const res = await launchCustomSession(
      { projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high" },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no unused import, `launchCustomSession` resolves).

- [ ] **Step 4: Manual smoke (server routes are not unit-tested in this repo)**

Run: `npx vitest run`
Expected: PASS (no regressions). Route behavior is verified end-to-end in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/sessions/route.ts
git commit -m "feat(mojito): projects endpoint and custom launch branch (RIC-115)"
```

---

### Task 7: UI — New Session sheet + custom card rendering

**Files:**
- Create: `src/components/NewSessionSheet.tsx`
- Modify: `src/components/SessionList.tsx` (add button + custom-card branch)

**Interfaces:**
- Consumes: `apiFetch`, `SessionMeta`, `StateBadge`, `FilterBar`.
- Produces: `NewSessionSheet` component (props below).

- [ ] **Step 1: Create `NewSessionSheet`**

Create `src/components/NewSessionSheet.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GENERAL = "__general__";

export default function NewSessionSheet(
  { token, onClose, onLaunched }:
  { token: string; onClose: () => void; onLaunched: () => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

  const start = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "custom", projectName: project === GENERAL ? null : project, model, effort }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <div className="two">
          <label className="field"><span className="lbl">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field"><span className="lbl">Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <button className="btn primary block" onClick={start}>Start session</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the button and custom card into `SessionList`**

In `src/components/SessionList.tsx`:

1. Add imports and state:

```tsx
import NewSessionSheet from "./NewSessionSheet";
```
```tsx
  const [newOpen, setNewOpen] = useState(false);
```

2. Add a `New session` button to the `FilterBar` action prop (keep Clean up). Replace the existing `action={...}` with:

```tsx
          action={
            <>
              <button className="btn ghost sm" onClick={() => setNewOpen(true)}>New session</button>
              <button className="btn ghost sm" onClick={cleanup}>Clean up</button>
            </>
          }
```

3. Because the `+ New session` entry must be reachable even with zero sessions, render a standalone button when the list is empty. Replace the `{sessions.length === 0 && <p className="empty">No sessions.</p>}` line with:

```tsx
      {sessions.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="empty">No sessions.</p>
          <button className="btn primary block" onClick={() => setNewOpen(true)}>New session</button>
        </div>
      )}
```

4. Branch the card body on `kind`. Replace the block from `<div className="row">` down through the `s.message` line (the ticket/status/title header) with:

```tsx
                  {s.kind === "custom" ? (
                    <>
                      <div className="row">
                        <span className="session-title">{s.title}</span>
                        <span className="grow" />
                        <StateBadge state={s.state} />
                      </div>
                      <div className="meta"><span className="chip">custom</span></div>
                      {s.message && <div className="title">{s.message}</div>}
                    </>
                  ) : (
                    <>
                      <div className="row">
                        <span className="id">{s.ticket}</span>
                        <span className="grow" />
                        <StateBadge state={s.state} />
                      </div>
                      {s.title && <div className="session-title">{s.title}</div>}
                      <div className="status">{s.launchStatus}</div>
                      {s.message && <div className="title">{s.message}</div>}
                    </>
                  )}
```

5. In the `.meta` chip row below, hide the auto-advance toggle for custom sessions. Wrap the `auto:` toggle button:

```tsx
                    {s.kind !== "custom" && (
                      <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                        auto: {s.autoAdvance ? "on" : "off"}
                      </button>
                    )}
```

6. Make the dismiss prompt kind-aware — replace the `prompt` assignment in `dismiss`:

```tsx
    const label = s.ticket || s.title;
    const prompt = active ? `Kill the running session for ${label}?` : `Dismiss the session for ${label}?`;
```

7. Render the sheet near the bottom of the returned JSX (before the closing `</div>` of `.pad`):

```tsx
      {newOpen && <NewSessionSheet token={token} onClose={() => setNewOpen(false)} onLaunched={onChanged} />}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/NewSessionSheet.tsx src/components/SessionList.tsx
git commit -m "feat(mojito): New session sheet and custom session cards (RIC-115)"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Next.js build succeeds (routes `/api/projects` and the custom branch compile).

- [ ] **Step 3: Manual walk-through (requires tmux + a running dev server)**

Run: `npm run dev` in the worktree, open the UI, authenticate, go to the **Sessions** tab, click **New session**. Verify:
- the Project dropdown lists the names from `~/.claude/lime-projects.json` plus *General (home)*;
- choosing *General (home)* + Start creates a session whose card shows a `custom` chip and the label `home`, and whose tmux session opened `claude` in `$HOME`;
- choosing a project creates a session in that project's folder;
- the card shows a live state badge (starting → running) and no auto-advance toggle;
- after Claude sets a session title, the card label updates to it.

Document any deviation; do not mark complete on a failing step.

- [ ] **Step 4: Final commit (if any verification fix was needed)**

```bash
git add -A
git commit -m "chore(mojito): verify custom project sessions end-to-end (RIC-115)"
```
