# Plain zsh terminal launch (RIC-155) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everywhere Mojito offers to launch a custom (bare) claude session, also offer launching a plain `zsh` login terminal — no claude, no lifecycle.

**Architecture:** Add a new first-class `kind: "shell"` mirroring the existing `"custom"` launch path, minus every claude-specific concern (no hook-settings file, no launch-context file, no model/effort). The in-tmux command becomes `zsh -l` instead of `claude …`. UI adds a `Claude | Terminal` toggle to the two launch sheets; a new "Terminal" grouping bucket + hue keeps shells visually distinct.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript, tmux via `src/server/tmux.ts`, Vitest.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages). User-facing UI strings are English too (the existing sheets use English labels).
- Test/verify gate: `npx tsc --noEmit && npx vitest run` (run from the worktree).
- All work happens in the worktree `/Users/ricventu/code/Lime/mojito/.claude/worktrees/ricventu+ric-155-avvio-terminale` on branch `ricventu/ric-155-avvio-terminale`. Never commit to `main`.
- All mojito tmux session names keep the `mojito-` prefix (sweep/list rely on it).
- CSS is dark-theme only (single `:root`, no light-theme override) — add color vars once.
- A shell session has no model/effort and fires no claude hooks; it starts in state `"running"` and only `registry.recover` moves it (to `"failed"`) when its tmux dies.

---

### Task 1: Session kind `"shell"` + name helper

**Files:**
- Modify: `src/server/types.ts` (kind union; widen `effort`)
- Modify: `src/server/sessionKey.ts` (add `shellSessionName`)
- Test: `tests/server/sessionKey.test.ts`

**Interfaces:**
- Produces: `SessionMeta.kind` now includes `"shell"`; `SessionMeta.effort: Effort | ""`; `shellSessionName(slug: string, unique: string): string` → `mojito-shell-<slug>-<unique>`.

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/server/sessionKey.test.ts`, and add `shellSessionName` to the existing import from `@/server/sessionKey` on line 2:

```ts
describe("shellSessionName", () => {
  it("builds a prefixed name from slug and unique id", () => {
    expect(shellSessionName("mojito", "a1b2c3")).toBe("mojito-shell-mojito-a1b2c3");
  });
  it("uses the general slug form", () => {
    expect(shellSessionName("general", "ffffff")).toBe("mojito-shell-general-ffffff");
  });
  it("does not collide with a custom session name for the same slug/id", () => {
    expect(shellSessionName("x", "aaa")).not.toBe(customSessionName("x", "aaa"));
  });
});
```

The import line becomes:

```ts
import { statusSlug, tmuxName, parseIdentifier, validateTicket, customSessionName, rebaseSessionName, shellSessionName } from "@/server/sessionKey";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sessionKey.test.ts`
Expected: FAIL — `shellSessionName is not a function` / not exported.

- [ ] **Step 3: Add the name helper**

In `src/server/sessionKey.ts`, add after `customSessionName` (after line 27):

```ts
export function shellSessionName(slug: string, unique: string): string {
  return `mojito-shell-${slug}-${unique}`;
}
```

- [ ] **Step 4: Extend the session-kind union and widen effort**

In `src/server/types.ts`, change the `kind` field (line 16) and the `effort` field (line 21) of `SessionMeta`:

```ts
  kind: "lime" | "custom" | "rebase" | "shell"; // "lime" = ticket-lifecycle; "custom" = standalone claude; "rebase" = one-off To-QA rebase; "shell" = plain zsh terminal
```

```ts
  effort: Effort | "";   // "" for shell sessions, which have no model/effort
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/sessionKey.test.ts && npx tsc --noEmit`
Expected: PASS (sessionKey tests green; no type errors).

- [ ] **Step 6: Commit**

```bash
git add src/server/types.ts src/server/sessionKey.ts tests/server/sessionKey.test.ts
git commit -m "feat(mojito): add shell session kind and name helper (RIC-155)"
```

---

### Task 2: Server — `buildShellCommand` + `launchShellSession`

**Files:**
- Modify: `src/server/launch.ts`
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `shellSessionName` (Task 1); existing `defaultResolveCwd`, `resolvePathForProject`, `loadProjectMap`, `logfilePath`, `LaunchDeps`.
- Produces:
  - `interface ShellLaunchRequest { projectName: string | null; ticket?: string; status?: string; title?: string; labels?: string[] }`
  - `buildShellCommand(): string` → `"zsh -l"`
  - `launchShellSession(req: ShellLaunchRequest, deps: LaunchDeps & { genId?: () => string; homeDir?: () => string }): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }>`

- [ ] **Step 1: Write the failing tests**

In `tests/server/launch.test.ts`, add `buildShellCommand` and `launchShellSession` to the import block (lines 5-9). It becomes:

```ts
import {
  launchSession, buildClaudeCommand, launchCustomSession, buildCustomClaudeCommand,
  launchNewTicketSession, buildNewTicketClaudeCommand,
  launchRebaseSession, buildRebaseClaudeCommand,
  buildShellCommand, launchShellSession,
} from "@/server/launch";
```

Append these describe blocks to the end of the file (they reuse the existing `customDeps` helper defined at line 124):

```ts
describe("buildShellCommand", () => {
  it("returns a bare login zsh with no claude, settings, or slash command", () => {
    const cmd = buildShellCommand();
    expect(cmd).toBe("zsh -l");
    expect(cmd).not.toContain("claude");
    expect(cmd).not.toContain("--settings");
    expect(cmd).not.toContain("/lime");
  });
});

describe("launchShellSession", () => {
  it("General opens a shell in the home directory, running, with empty model/effort", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: null }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-general-abc123", ticket: "",
      launchStatus: "", cwd: "/home/me", projectName: null, title: "home", autoAdvance: false,
      state: "running", model: "", effort: "" });
    expect(d.newSession).toHaveBeenCalledWith("mojito-shell-general-abc123", "/home/me", "zsh -l");
    expect(d.pipePane).toHaveBeenCalledOnce();
  });

  it("a mapped project opens a shell in its folder with the basename label", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchShellSession({ projectName: "Mojito" }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-mojito-abc123",
      cwd: "/code/Lime/mojito", projectName: "Mojito", title: "mojito" });
  });

  it("writes NEITHER a hook-settings file NOR a launch-context file", async () => {
    const d = customDeps();
    await launchShellSession({ projectName: null }, d);
    expect(existsSync(join(dir, "settings", "mojito-shell-general-abc123.json"))).toBe(false);
    expect(existsSync(join(dir, "context", "mojito-shell-general-abc123.json"))).toBe(false);
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: "Ghost" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });

  it("registers the session in the registry", async () => {
    const d = customDeps();
    const res = await launchShellSession({ projectName: null }, d);
    const id = (res as { ok: true; meta: SessionMeta }).meta.id;
    expect(d.registry.get(id)?.kind).toBe("shell");
  });

  it("a ticket-scoped shell opens in the worktree with ticket/title/labels and no context file", async () => {
    const d = customDeps({ resolveCwd: () => "/wt/ric-155" });
    const res = await launchShellSession(
      { projectName: "Mojito", ticket: "RIC-155", status: "Todo", title: "Avvio terminale", labels: ["Feature"] }, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "shell", id: "mojito-shell-ric-155-abc123",
      ticket: "RIC-155", launchStatus: "", cwd: "/wt/ric-155", projectName: "Mojito",
      title: "Avvio terminale", labels: ["Feature"], state: "running" });
    expect(existsSync(join(dir, "context", "mojito-shell-ric-155-abc123.json"))).toBe(false);
    expect(d.newSession).toHaveBeenCalledWith("mojito-shell-ric-155-abc123", "/wt/ric-155", "zsh -l");
  });

  it("refuses when the ticket's team/project is unmapped", async () => {
    const d = customDeps({ resolveCwd: () => null });
    const res = await launchShellSession({ projectName: "Mojito", ticket: "RIC-155" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — `buildShellCommand`/`launchShellSession` not exported.

- [ ] **Step 3: Implement the shell launch**

In `src/server/launch.ts`, add `shellSessionName` to the import from `./sessionKey.js` (line 6):

```ts
import { tmuxName, parseIdentifier, validateTicket, statusSlug, customSessionName, rebaseSessionName, shellSessionName } from "./sessionKey.js";
```

Then append at the end of the file:

```ts
export interface ShellLaunchRequest {
  projectName: string | null;
  // Ticket-scoped shell (RIC-155): when `ticket` is set, cwd resolves through the
  // ticket→worktree chain. Absent = project-scoped, or general (home) when projectName is null.
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
}

export function buildShellCommand(): string {
  // A plain login shell — behaves like a normally-opened terminal (sources the user's profile).
  // No env prefix, no --settings, no slash command: a shell fires no claude hooks.
  return "zsh -l";
}

export async function launchShellSession(
  req: ShellLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));

  // Same cwd/slug resolution as launchCustomSession.
  let cwd: string;
  let slug: string;
  if (req.ticket) {
    const resolveCwd = deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath);
    const resolved = resolveCwd(req.ticket, req.projectName);
    if (!resolved) return { ok: false, reason: "no-repo" };
    cwd = resolved;
    slug = statusSlug(req.ticket);
  } else if (req.projectName) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), req.projectName);
    if (!path) return { ok: false, reason: "no-repo" };
    cwd = path;
    slug = statusSlug(req.projectName);
  } else {
    cwd = homeDir();
    slug = "general";
  }

  const id = shellSessionName(slug, genId());

  // A plain shell writes no hook-settings file and no launch-context file.
  const command = buildShellCommand();
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "shell",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: "",
    effort: "",
    autoAdvance: false,
    // No hooks will ever move a shell off its initial state, so start it "running" for a
    // sensible badge. registry.recover flips it to "failed" only when its tmux dies.
    state: "running",
    cwd,
    createdAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
    projectName: req.projectName,
    title,
    labels: req.ticket ? (req.labels ?? []) : [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/launch.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(mojito): launchShellSession spawns a plain zsh terminal (RIC-155)"
```

---

### Task 3: API dispatch for `kind: "shell"`

**Files:**
- Modify: `src/app/api/sessions/route.ts`

**Interfaces:**
- Consumes: `launchShellSession` (Task 2).

> Note: the repo has no unit test for the `POST /api/sessions` route (dispatch is exercised only through the launch-function tests). This task follows that established pattern and is verified by `npx tsc --noEmit` plus manual smoke; no route test is added.

- [ ] **Step 1: Add the import**

In `src/app/api/sessions/route.ts`, extend the launch import (line 4):

```ts
import { launchSession, launchCustomSession, launchNewTicketSession, launchRebaseSession, launchShellSession } from "@/server/launch";
```

- [ ] **Step 2: Add the dispatch branch**

Insert this block immediately after the `rebase` branch (after line 73, before the lime fallthrough `const res = await launchSession(`):

```ts
  if (body.kind === "shell") {
    const res = await launchShellSession(
      { projectName: body.projectName ?? null,
        ...(typeof body.ticket === "string" && body.ticket
          ? { ticket: body.ticket, status: body.status ?? "", title: body.title ?? "",
              labels: Array.isArray(body.labels) ? body.labels : [] }
          : {}) },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
```

- [ ] **Step 3: Verify types and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sessions/route.ts
git commit -m "feat(mojito): route kind=shell to launchShellSession (RIC-155)"
```

---

### Task 4: "Terminal" grouping bucket + hue

**Files:**
- Modify: `src/lib/status.ts`
- Modify: `src/lib/sessionFilter.ts`
- Modify: `src/app/globals.css`
- Test: `tests/lib/status.test.ts`, `tests/lib/sessionFilter.test.ts`

**Interfaces:**
- Produces: `TERMINAL_STATUS = "Terminal"` (exported from `status.ts`, re-exported from `sessionFilter.ts`); `statusColorClass("Terminal") === "term"`; `sessionStatus(s)` returns `TERMINAL_STATUS` for `kind === "shell"`.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/status.test.ts`, change the import (line 3) to include the buckets, then add a test:

```ts
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/status";
```

```ts
  it("gives the custom and terminal buckets their own distinct hues", () => {
    expect(statusColorClass(CUSTOM_STATUS)).toBe("pink");
    expect(statusColorClass(TERMINAL_STATUS)).toBe("term");
    expect(statusColorClass(CUSTOM_STATUS)).not.toBe(statusColorClass(TERMINAL_STATUS));
  });
```

In `tests/lib/sessionFilter.test.ts`, change the import (line 2) to include `TERMINAL_STATUS`, then add two tests inside the existing describes:

```ts
import { sessionStatuses, filterSessions, sessionStatus, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/sessionFilter";
```

Add to the `describe("sessionStatuses", …)` block:

```ts
  it("surfaces shell sessions as the TERMINAL_STATUS bucket, sorted last", () => {
    const sessions = [
      session({ kind: "shell", launchStatus: "" }),
      session({ launchStatus: "To QA" }),
    ];
    expect(sessionStatuses(sessions)).toEqual(["To QA", TERMINAL_STATUS]);
  });
```

Add to the `describe("filterSessions", …)` block:

```ts
  it("filters shell sessions via the TERMINAL_STATUS bucket", () => {
    const withShell = [
      ...sessions,
      session({ id: "e", kind: "shell", launchStatus: "", ticket: "", projectName: "Mojito", title: "Terminal one" }),
    ];
    const out = filterSessions(withShell, { query: "", project: null, status: TERMINAL_STATUS });
    expect(out.map((s) => s.id)).toEqual(["e"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/status.test.ts tests/lib/sessionFilter.test.ts`
Expected: FAIL — `TERMINAL_STATUS` is not exported; `statusColorClass("Terminal")` returns `"muted"`.

- [ ] **Step 3: Add the bucket constant and hue**

In `src/lib/status.ts`, add after the `CUSTOM_STATUS` export (after line 23):

```ts
/**
 * Synthetic non-lifecycle status for plain-terminal (shell) sessions, parallel to
 * CUSTOM_STATUS. Absent from STATUS_ORDER/STATUS_COLOR; its rank falls through to
 * "last" and its hue is handled explicitly in statusColorClass.
 */
export const TERMINAL_STATUS = "Terminal";
```

And in `statusColorClass` (lines 44-47), add the terminal branch:

```ts
export function statusColorClass(name: string): string {
  if (name === CUSTOM_STATUS) return "pink";
  if (name === TERMINAL_STATUS) return "term";
  return STATUS_COLOR[name] ?? "muted";
}
```

- [ ] **Step 4: Bucket shell sessions in sessionFilter**

In `src/lib/sessionFilter.ts`, update the import (line 2), the re-export (line 11), and `sessionStatus` (lines 17-19):

```ts
import { statusRank, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/status";
```

```ts
export { CUSTOM_STATUS, TERMINAL_STATUS };
```

```ts
export function sessionStatus(s: SessionMeta): string {
  if (s.kind === "custom") return CUSTOM_STATUS;
  if (s.kind === "shell") return TERMINAL_STATUS;
  return s.launchStatus;
}
```

- [ ] **Step 5: Add the CSS hue**

In `src/app/globals.css`, add the color variables right after the `--pink` line (line 32):

```css
  --term: #b5d334;   --term-bg: #26290f;   /* shell/terminal sessions (non-lifecycle) */
```

Add the badge rule right after `.badge.pink` (line 177):

```css
.badge.term   { color: var(--term);       background: var(--term-bg);   border-color: color-mix(in srgb, var(--term) 45%, transparent); }
```

Add the filter-chip rule right after `.filter-chips .chip.pink` (line 143):

```css
.filter-chips .chip.term   { color: var(--term);       border-color: color-mix(in srgb, var(--term) 45%, transparent); }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/status.test.ts tests/lib/sessionFilter.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/status.ts src/lib/sessionFilter.ts src/app/globals.css tests/lib/status.test.ts tests/lib/sessionFilter.test.ts
git commit -m "feat(mojito): Terminal grouping bucket and hue for shell sessions (RIC-155)"
```

---

### Task 5: Render shell sessions in the session list

**Files:**
- Modify: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `kind: "shell"` (Task 1).

> Note: the repo has no React component tests. This task is verified by `npx tsc --noEmit` and manual smoke (see Step 4).

- [ ] **Step 1: Render shell title-first like custom**

In `src/components/SessionList.tsx`, change the card-body condition (line 93) from:

```tsx
                      {s.kind === "custom" ? (
```

to:

```tsx
                      {s.kind === "custom" || s.kind === "shell" ? (
```

- [ ] **Step 2: Hide the model·effort chip for shells and add a terminal chip**

In the `.meta` block (lines 113-121), replace the model·effort chip line (line 114) and the rebase-chip line (line 115) so it reads:

```tsx
                      <div className="meta">
                        {s.kind !== "shell" && <span className="chip">{s.model} · {s.effort}</span>}
                        {s.kind === "rebase" && <span className="chip">rebase</span>}
                        {s.kind === "shell" && <span className="chip">terminal</span>}
                        {s.kind === "lime" && (
                          <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                            auto: {s.autoAdvance ? "on" : "off"}
                          </button>
                        )}
                      </div>
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke (optional but recommended)**

If the dev server is available, launch a terminal session from the Sessions tab (after Task 6) and confirm the card shows the title, a green `terminal` chip, a `running` badge, no `model · effort` chip, and no `auto:` toggle; opening it attaches to a live zsh prompt.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionList.tsx
git commit -m "feat(mojito): render shell sessions with a terminal chip (RIC-155)"
```

---

### Task 6: `Claude | Terminal` toggle in NewSessionSheet (Sessions tab)

**Files:**
- Modify: `src/components/NewSessionSheet.tsx`

**Interfaces:**
- Consumes: the `kind: "shell"` API branch (Task 3).

> Note: no React component tests in the repo; verified by `npx tsc --noEmit` and manual smoke.

- [ ] **Step 1: Replace the sheet with the toggle version**

Replace the entire contents of `src/components/NewSessionSheet.tsx` with:

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
  const [mode, setMode] = useState<"claude" | "terminal">("claude");
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
    const projectName = project === GENERAL ? null : project;
    const body = mode === "terminal"
      ? { kind: "shell", projectName }
      : { kind: "custom", projectName, model, effort };
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New session</h3>
        <div className="btns" style={{ marginBottom: 12 }}>
          <button className={`btn ${mode === "claude" ? "primary" : "ghost"}`} onClick={() => setMode("claude")}>Claude</button>
          <button className={`btn ${mode === "terminal" ? "primary" : "ghost"}`} onClick={() => setMode("terminal")}>Terminal</button>
        </div>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        {mode === "claude" && (
          <div className="two">
            <label className="field"><span className="lbl">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="field"><span className="lbl">Effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
          </div>
        )}
        <button className="btn primary block" onClick={start}>{mode === "terminal" ? "Start terminal" : "Start session"}</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke (recommended)**

Sessions tab → New session → toggle **Terminal**: model/effort disappear, button reads "Start terminal". Pick "General (home)", start, confirm a shell card appears under a "Terminal" group and opening it shows a live zsh prompt in `$HOME`. Toggle back to **Claude**: model/effort reappear and behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/NewSessionSheet.tsx
git commit -m "feat(mojito): Claude/Terminal toggle in the new-session sheet (RIC-155)"
```

---

### Task 7: `Claude | Terminal` toggle for the ticket-scoped bare session (LaunchSheet)

**Files:**
- Modify: `src/components/LaunchSheet.tsx`

**Interfaces:**
- Consumes: the `kind: "shell"` API branch (Task 3).

> Note: no React component tests in the repo; verified by `npx tsc --noEmit` and manual smoke. The lime lifecycle buttons (Start session, verdicts, rebase) and the model/effort selectors are left untouched — the toggle governs only the secondary bare-session control (formerly the single "Custom session" button).

- [ ] **Step 1: Add the mode state and a shell launcher**

In `src/components/LaunchSheet.tsx`, add a mode state next to the other `useState` calls (after line 22, `const [auto, setAuto] = useState(true);`):

```tsx
  const [bareMode, setBareMode] = useState<"claude" | "terminal">("claude");
```

Add a `startShell` handler right after `startCustom` (after line 92):

```tsx
  // Launch a plain zsh terminal in the ticket's worktree (RIC-155). Like startCustom, shell ids
  // are random-suffixed, so there is no existing session to clear first.
  const startShell = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "shell", ticket: ticket.identifier, status: ticket.statusName,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };
```

- [ ] **Step 2: Replace the `customBtn` element with a toggle + button pair**

Replace the `customBtn` definition (lines 105-107) with:

```tsx
  const customBtn = (
    <div style={{ marginTop: 12 }}>
      <div className="btns" style={{ marginBottom: 8 }}>
        <button className={`btn ${bareMode === "claude" ? "primary" : "ghost"}`} onClick={() => setBareMode("claude")}>Claude</button>
        <button className={`btn ${bareMode === "terminal" ? "primary" : "ghost"}`} onClick={() => setBareMode("terminal")}>Terminal</button>
      </div>
      {bareMode === "claude"
        ? <button className="btn ghost block" onClick={() => startCustom()}>Custom session</button>
        : <button className="btn ghost block" onClick={() => startShell()}>Start terminal</button>}
    </div>
  );
```

(The three render sites that already use `{customBtn}` — lines 123, 129, 150 — need no change; they now render the toggle + button.)

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke (recommended)**

Tickets tab → open a ticket → in the sheet, the bare-session control now shows a Claude|Terminal toggle. With **Terminal** selected, "Start terminal" launches a shell in the ticket's worktree (confirm the card groups under "Terminal" and the prompt is in the worktree dir). With **Claude** selected, "Custom session" behaves exactly as before. The main lifecycle "Start session" button and the model/effort selectors are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/LaunchSheet.tsx
git commit -m "feat(mojito): Claude/Terminal toggle for ticket bare session (RIC-155)"
```

---

## Final verification

- [ ] Run the full gate from the worktree: `npx tsc --noEmit && npx vitest run` — expect 0 type errors and all tests passing (287 pre-existing + the new shell/terminal tests).
- [ ] (Optional) `npm run build` in the worktree to confirm the production build compiles.
- [ ] Manual end-to-end: launch a terminal from both the Sessions tab and a ticket sheet; confirm each opens a live `zsh -l`, shows under the "Terminal" bucket with the terminal chip and running badge, and can be killed/dismissed.

## Self-review notes (author)

- **Spec coverage:** kind (`Task 1`), naming (`Task 1`), server build+launch with no settings/context (`Task 2`), API dispatch (`Task 3`), state=running (`Task 2`), grouping+hue (`Task 4`), rendering with hidden model/effort + terminal chip (`Task 5`), UI toggle both sheets (`Tasks 6-7`), tests (`Tasks 1,2,4`). All spec sections mapped.
- **Type consistency:** `shellSessionName`, `buildShellCommand`, `launchShellSession`, `ShellLaunchRequest`, `TERMINAL_STATUS`, hue `"term"` used identically across tasks and tests.
- **Known coverage gap (intentional):** the API route and React components have no automated tests in this repo; those tasks are gated on `tsc` + manual smoke, consistent with the existing codebase.
