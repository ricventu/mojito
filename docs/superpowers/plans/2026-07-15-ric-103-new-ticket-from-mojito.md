# New Ticket from Mojito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a new Linear ticket from the Mojito UI by typing a free-form description, which a spawned `claude … /lime-new` session analyzes into a title + tidy description and files in Backlog.

**Architecture:** Cross-repo. First adapt the `lime-new` skill so its input is always a free-form brief it mini-analyzes (no verbatim-title path), readable from a new `LIME_NEW_CONTEXT` file. Then Mojito gets a `launchNewTicketSession` (a variant of `launchCustomSession`) that writes that context file and spawns `claude … /lime-new`, plus a `NewTicketSheet` opened from a **+ New ticket** button on the Tickets tab. The spawned session is a normal `kind:"custom"` session.

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 19, node-pty + tmux, vitest. The lime side is a Claude Code plugin skill (Markdown) + `plugin.json`.

## Global Constraints

- All code artifacts (identifiers, comments, commit messages, docs) in **English**. Ticket
  *content* (`lime-new`'s derived title/description) stays in the **brief's language** — it
  is user-facing.
- Mojito depends on lime one-directionally: **change lime first**, rebuild its plugin
  cache, then adapt Mojito.
- lime version bump: `.claude-plugin/plugin.json` `0.14.0` → `0.15.0`; `lime-new` runs from
  `~/.claude/plugins/cache/lime/lime/<version>/`, so the cache must be rebuilt before the
  new behavior is live.
- `LIME_NEW_CONTEXT` JSON shape: `{ "brief": string, "project": string | null }`.
- Session for a new-ticket launch: `kind:"custom"`, empty `ticket`/`launchStatus`,
  `title:"New ticket · <project|home>"`, `labels:[]`, `autoAdvance:false`.
- Command builder must reuse the existing single-quote escaping helper `q` so user text can
  never break out of its quoted token.
- Test gate for every Mojito task: `npx tsc --noEmit && npx vitest run`. Mojito has no UI
  test harness (tests live under `tests/server/` only); UI tasks are verified by typecheck
  + the end-to-end smoke in Task 7.

---

### Task 1: Adapt the `lime-new` skill (lime repo)

Lives in the **lime** repo, not this worktree. All paths below are under
`/Users/ricventu/code/Lime/lime`.

**Files:**
- Modify: `skills/lime-new/SKILL.md`
- Modify: `.claude-plugin/plugin.json` (version `0.14.0` → `0.15.0`)

**Interfaces:**
- Produces: the `LIME_NEW_CONTEXT` contract — env var pointing at a JSON file
  `{ brief, project }` — that Mojito's Task 3 writes and this skill reads.

- [ ] **Step 1: Add a launch-context read step to `SKILL.md`.**

Under "## Step 1 — Gather the ticket content", replace the current title/description items
with a brief-first flow. Insert a new item before it:

```markdown
0. **Read the launch context first.** Check the env var `LIME_NEW_CONTEXT`
   (e.g. `echo "$LIME_NEW_CONTEXT"`). If it is set and the file exists, Read it — a small
   JSON `{ "brief": string, "project": string | null }` written by the launcher (mojito).
   Take the **brief** from it, and when `project` is non-null treat it as the
   **authoritative** project (skip the project parsing/cwd reverse-lookup in Step 2 for the
   project itself; still resolve the team from it). If `LIME_NEW_CONTEXT` is unset or
   missing, the **brief** is the command argument instead.
```

- [ ] **Step 2: Rewrite the input semantics — brief, not title.**

Replace items 1–2 of "Step 1 — Gather the ticket content" with:

```markdown
1. **Brief** (required): a free-form description of the desired ticket, from the launch
   context (item 0) or, absent that, the command argument (`/lime-new "<description>"`).
   If no brief is available (empty argument and no context), STOP and ask for one:
   `/lime-new "<description>"`.
2. **Mini-analysis (required, before creating).** Turn the brief into a proper ticket:
   derive a **concise title** and a **tidy, structured description**, both in the brief's
   own language. This is a light rewrite/cleanup only — do NOT brainstorm, do NOT ask
   clarifying questions, do NOT invent scope or requirements. Brainstorming happens later
   in Stage 1 of the lifecycle. The analyzed title + description are what you create.
```

- [ ] **Step 3: Honor the authoritative project in Step 2.**

In "## Step 2 — Resolve the team and project", add as the first resolution rule:

```markdown
0. **Project from the launch context.** If `LIME_NEW_CONTEXT` supplied a non-null
   `project`, use it as the project (authoritative) and resolve its team from the map.
   Skip rules 1 and 3's project handling; only fall through for the team if the map has no
   entry for it.
```

Leave the existing prompt/CLI/cwd rules as the fallback when no context project is present.

- [ ] **Step 4: Point Step 3 (create) at the analyzed content.**

In "## Step 3 — Create the ticket", change the `save_issue` call to use the **analyzed
title and description** from Step 1 item 2 (not a raw argument). No confirmation prompt
(unchanged convention).

- [ ] **Step 5: Update the guard summary + front-matter description.**

In the front-matter `description:` and "## Guard summary", replace "turns a title (and
optional description)" phrasing with "turns a free-form description into a Backlog issue
after a mini-analysis". Add a guard line:
`- No brief (empty arg and no LIME_NEW_CONTEXT) → stop, ask for one.`

- [ ] **Step 6: Bump the plugin version.**

Edit `.claude-plugin/plugin.json`: `"version": "0.14.0"` → `"version": "0.15.0"`.

```bash
grep '"version"' /Users/ricventu/code/Lime/lime/.claude-plugin/plugin.json
```
Expected: `"version": "0.15.0",`

- [ ] **Step 7: Commit the lime change (on a lime-repo branch).**

```bash
cd /Users/ricventu/code/Lime/lime
git checkout -b ricventu/lime-new-analyze-brief
git add skills/lime-new/SKILL.md .claude-plugin/plugin.json
git commit -m "feat(lime-new): analyze a free-form brief into a ticket; add LIME_NEW_CONTEXT (RIC-103)"
```

- [ ] **Step 8: Rebuild the plugin cache (USER action — interactive).**

The `/plugin` update is a user-only Claude Code command; the agent cannot run it. Ask the
user to update the lime plugin so the cache rebuilds, then verify:

```bash
ls ~/.claude/plugins/cache/lime/lime/0.15.0/
```
Expected: the directory exists (skill runs from here, not source).

---

### Task 2: `writeNewTicketContext` — the LIME_NEW_CONTEXT writer

**Files:**
- Modify: `src/server/launchContext.ts`
- Test: `tests/server/launchContext.test.ts`

**Interfaces:**
- Produces: `interface NewTicketContext { brief: string; project: string | null }` and
  `writeNewTicketContext(stateDir: string, id: string, ctx: NewTicketContext): string`
  (returns the written file path `<stateDir>/context/<id>.json`).

- [ ] **Step 1: Write the failing test.**

Append to `tests/server/launchContext.test.ts`:

```ts
import { writeNewTicketContext, type NewTicketContext } from "@/server/launchContext";

const newCtx: NewTicketContext = { brief: "Aggiungi un pulsante per esportare in CSV", project: "Mojito" };

describe("writeNewTicketContext", () => {
  it("writes the { brief, project } JSON and returns its path", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-mojito-abc123", newCtx);
    expect(p).toBe(join(dir, "context", "mojito-custom-mojito-abc123.json"));
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(newCtx);
  });

  it("writes with owner-only permissions", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-mojito-abc123", newCtx);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("accepts a null project", () => {
    const p = writeNewTicketContext(dir, "mojito-custom-general-abc123", { brief: "x", project: null });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "x", project: null });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run tests/server/launchContext.test.ts`
Expected: FAIL — `writeNewTicketContext` is not exported.

- [ ] **Step 3: Implement it.**

Append to `src/server/launchContext.ts`:

```ts
export interface NewTicketContext {
  brief: string;
  project: string | null;
}

/**
 * Write the per-session context the lime-new skill reads to analyze a free-form brief and
 * associate the selected project. Mirrors writeLaunchContext; returns the file path so the
 * caller can pass it to the session via LIME_NEW_CONTEXT.
 */
export function writeNewTicketContext(stateDir: string, id: string, ctx: NewTicketContext): string {
  const dir = join(stateDir, "context");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(ctx, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `npx vitest run tests/server/launchContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/server/launchContext.ts tests/server/launchContext.test.ts
git commit -m "feat(mojito): add writeNewTicketContext for the LIME_NEW_CONTEXT contract (RIC-103)"
```

---

### Task 3: `launchNewTicketSession` + API route branch

**Files:**
- Modify: `src/server/launch.ts`
- Modify: `src/app/api/sessions/route.ts`
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `writeNewTicketContext` (Task 2); existing `resolvePathForProject`,
  `customSessionName`, `statusSlug`, `buildHookSettings`, `logfilePath`.
- Produces:
  - `buildNewTicketClaudeCommand(settingsPath: string, contextPath: string): string`
  - `interface NewTicketLaunchRequest { brief: string; projectName: string | null; model: string; effort: Effort }`
  - `launchNewTicketSession(req: NewTicketLaunchRequest, deps: LaunchDeps & { genId?: () => string; homeDir?: () => string }): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }>`

- [ ] **Step 1: Write the failing tests.**

Append to `tests/server/launch.test.ts` (imports at top: add
`launchNewTicketSession, buildNewTicketClaudeCommand` to the existing `@/server/launch`
import; add `readFileSync` to the `node:fs` import):

```ts
describe("buildNewTicketClaudeCommand", () => {
  it("prefixes LIME_NEW_CONTEXT and runs /lime-new", () => {
    const cmd = buildNewTicketClaudeCommand(
      { projectName: null, model: "opus", effort: "high", brief: "x" },
      "/s/x.json",
      "/state/context/mojito-custom-general-abc123.json",
    );
    expect(cmd).toMatch(/^LIME_NEW_CONTEXT='\/state\/context\/mojito-custom-general-abc123.json' claude /);
    expect(cmd).toContain("--model 'opus' --effort 'high'");
    expect(cmd).toContain("--settings '/s/x.json'");
    expect(cmd).toContain("'/lime-new'");
    expect(cmd).not.toContain("/lime-next");
  });
});

describe("launchNewTicketSession", () => {
  it("General opens in the home directory with a New ticket · home title", async () => {
    const d = customDeps();
    const res = await launchNewTicketSession(
      { brief: "Aggiungi export CSV", projectName: null, model: "opus", effort: "high" }, d,
    );
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "custom", id: "mojito-custom-new-ticket-abc123", ticket: "", launchStatus: "",
      cwd: "/home/me", projectName: null, title: "New ticket · home", autoAdvance: false,
    });
    expect(d.newSession).toHaveBeenCalledWith(
      "mojito-custom-new-ticket-abc123", "/home/me",
      expect.stringContaining("'/lime-new'"),
    );
  });

  it("a mapped project opens in its folder with the project in the title", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    const res = await launchNewTicketSession(
      { brief: "x", projectName: "Mojito", model: "sonnet", effort: "low" }, d,
    );
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({
      kind: "custom", id: "mojito-custom-mojito-abc123", cwd: "/code/Lime/mojito",
      projectName: "Mojito", title: "New ticket · Mojito",
    });
  });

  it("writes the LIME_NEW_CONTEXT file with the brief and project", async () => {
    const projectsPath = join(dir, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
    const d = customDeps({ projectsPath });
    await launchNewTicketSession({ brief: "Aggiungi export CSV", projectName: "Mojito", model: "opus", effort: "high" }, d);
    const p = join(dir, "context", "mojito-custom-mojito-abc123.json");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "Aggiungi export CSV", project: "Mojito" });
  });

  it("refuses an unmapped project", async () => {
    const d = customDeps();
    const res = await launchNewTicketSession({ brief: "x", projectName: "Ghost", model: "opus", effort: "high" }, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});
```

- [ ] **Step 2: Run to confirm failure.**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: FAIL — `launchNewTicketSession` / `buildNewTicketClaudeCommand` not exported.

- [ ] **Step 3: Implement in `src/server/launch.ts`.**

Add the import for the context writer (top of file, alongside the existing
`writeLaunchContext` import):

```ts
import { writeLaunchContext, writeNewTicketContext } from "./launchContext.js";
```

Append at the end of the file:

```ts
export interface NewTicketLaunchRequest {
  brief: string;
  projectName: string | null;
  model: string;
  effort: Effort;
}

export function buildNewTicketClaudeCommand(
  req: NewTicketLaunchRequest,
  settingsPath: string,
  contextPath: string,
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return (
    `LIME_NEW_CONTEXT=${q(contextPath)} ` +
    `claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)} ${q("/lime-new")}`
  );
}

export async function launchNewTicketSession(
  req: NewTicketLaunchRequest,
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

  const slug = req.projectName ? statusSlug(req.projectName) : "new-ticket";
  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  const contextPath = writeNewTicketContext(deps.stateDir, id, { brief: req.brief, project: req.projectName });

  const command = buildNewTicketClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

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
    title: `New ticket · ${req.projectName ?? "home"}`,
    labels: [],
  };
  deps.registry.upsert(meta);
  return { ok: true, meta };
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: PASS (all new + existing cases).

- [ ] **Step 5: Wire the API route branch.**

In `src/app/api/sessions/route.ts`, add the import:

```ts
import { launchSession, launchCustomSession, launchNewTicketSession } from "@/server/launch";
```

Inside `POST`, immediately after the `if (body.kind === "custom") { … }` block, add:

```ts
  if (body.kind === "new-ticket") {
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    if (!brief) return NextResponse.json({ error: "empty brief" }, { status: 400 });
    const res = await launchNewTicketSession(
      { brief, projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high" },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
```

- [ ] **Step 6: Full gate + commit.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean, all tests pass.

```bash
git add src/server/launch.ts src/app/api/sessions/route.ts tests/server/launch.test.ts
git commit -m "feat(mojito): launchNewTicketSession spawns /lime-new to file a ticket (RIC-103)"
```

---

### Task 4: `NewTicketSheet` UI component

**Files:**
- Create: `src/components/NewTicketSheet.tsx`

**Interfaces:**
- Consumes: `POST /api/sessions` with `{ kind:"new-ticket", brief, projectName, model, effort }`
  returning a `SessionMeta` (201).
- Produces: `NewTicketSheet` props
  `{ token: string; onClose: () => void; onCreated: (meta: SessionMeta) => void }`.

- [ ] **Step 1: Create the component.**

```tsx
"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import type { SessionMeta } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GENERAL = "__general__";

export default function NewTicketSheet(
  { token, onClose, onCreated }:
  { token: string; onClose: () => void; onCreated: (meta: SessionMeta) => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

  const create = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        kind: "new-ticket", brief: brief.trim(),
        projectName: project === GENERAL ? null : project, model, effort,
      }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    const meta: SessionMeta = await res.json();
    onCreated(meta);
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New ticket</h3>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <label className="field"><span className="lbl">Description</span>
          <textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe the ticket — Claude will turn it into a title + description." />
        </label>
        <div className="two">
          <label className="field"><span className="lbl">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field"><span className="lbl">Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <button className="btn primary block" disabled={!brief.trim()} onClick={create}>Create ticket</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/components/NewTicketSheet.tsx
git commit -m "feat(mojito): NewTicketSheet form for creating Linear tickets (RIC-103)"
```

---

### Task 5: **+ New ticket** button on the Tickets tab

**Files:**
- Modify: `src/components/TicketList.tsx`

**Interfaces:**
- Consumes: `NewTicketSheet` (Task 4); the existing `onOpen(s: SessionMeta)` and
  `onLaunched()` props of `TicketList`.

- [ ] **Step 1: Import and add state.**

At the top of `src/components/TicketList.tsx`, add the import:

```tsx
import NewTicketSheet from "./NewTicketSheet";
```

Add state next to the existing `useState` calls:

```tsx
  const [newOpen, setNewOpen] = useState(false);
```

- [ ] **Step 2: Add the always-visible header button.**

Immediately inside `return ( <div className="pad">`, before the
`{tickets.length > 0 && ( <FilterBar … /> )}` block, insert:

```tsx
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
      </div>
```

- [ ] **Step 3: Render the sheet and auto-open the created session.**

Just before the closing `</div>` of the component (after the `{picked && ( … )}` block),
add:

```tsx
      {newOpen && (
        <NewTicketSheet token={token}
          onClose={() => setNewOpen(false)}
          onCreated={(meta) => { onLaunched(); onOpen(meta); }} />
      )}
```

`onLaunched()` refreshes the tickets + sessions lists; `onOpen(meta)` opens the new
session's terminal so the user can answer if `/lime-new` needs a team (home-scoped launch).

- [ ] **Step 4: Typecheck + commit.**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/components/TicketList.tsx
git commit -m "feat(mojito): + New ticket entry point on the Tickets tab (RIC-103)"
```

---

### Task 6: Document the `LIME_NEW_CONTEXT` contract

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the contract to the shared-contract section.**

In `CLAUDE.md`, under "### The shared contract (what must stay in sync)", after the
`Launch context` item (1), add:

```markdown
1b. **New-ticket context** — for the "New ticket" UI flow, Mojito writes a
   `LIME_NEW_CONTEXT` file (`writeNewTicketContext` in `src/server/launchContext.ts`,
   called from `launchNewTicketSession` in `src/server/launch.ts`) holding
   `{ brief, project }`. The spawned `claude … /lime-new` session reads it to analyze the
   brief and associate the project. If you change these fields, update lime's
   `skills/lime-new/SKILL.md` context-read step to match.
```

- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs(mojito): document the LIME_NEW_CONTEXT contract (RIC-103)"
```

---

### Task 7: End-to-end verification

**Files:** none (manual smoke test).

- [ ] **Step 1: Full gate.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean, all tests pass.

- [ ] **Step 2: Confirm lime cache is live.**

```bash
ls ~/.claude/plugins/cache/lime/lime/0.15.0/
```
Expected: exists (Task 1 Step 8). If not, the flow will run the old `lime-new`.

- [ ] **Step 3: Manual smoke (dev server).**

Per memory, a live dev server may already run on `:8700` sharing `.next` — do NOT start a
second server in the main checkout. Use the running instance (or `npm run dev` in this
worktree on a free port). Then:
1. Open the Tickets tab → click **+ New ticket**.
2. Pick project **Mojito**, type a short Italian brief, click **Create ticket**.
3. The new session's terminal opens; `/lime-new` runs, analyzes the brief, and creates a
   **Backlog** ticket in Linear associated to **Mojito**, printing the ID + URL.
4. Repeat with **General (home)** and no project → the session opens in `$HOME`; if
   `lime-new` needs a team it asks in the terminal.
5. Back on the Tickets tab, refresh shows the new Backlog ticket.

- [ ] **Step 4: Finish the branch.**

Hand off to the lifecycle: the ticket advances To Review via the normal flow. (No commit —
this task is verification only.)
