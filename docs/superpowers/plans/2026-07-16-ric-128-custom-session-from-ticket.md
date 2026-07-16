# Custom Session From a Ticket (RIC-128) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a ticket's LaunchSheet, launch a bare (`kind: "custom"`) claude session in the ticket's worktree (falling back to the repo root), with the ticket's `LIME_SESSION_CONTEXT` written so the session is ticket-aware — but never running `/lime-next`.

**Architecture:** Extend the existing single custom-launch path (`launchCustomSession`) with optional ticket fields rather than adding a parallel function. When a ticket is present, cwd resolves through the same ticket→worktree chain the lime path uses (`resolveWorktree(repo, ticket) ?? repo`) and a launch-context file is written; otherwise behavior is exactly today's project-scoped custom session. The API route forwards the ticket fields; the UI adds a "Custom session" button available in every state of the LaunchSheet.

**Tech Stack:** Next.js (App Router) + TypeScript, Node server layer under `src/server/`, vitest tests under `tests/server/`, tmux-backed sessions.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages). User-facing ticket titles stay verbatim.
- Custom sessions always launch **bare claude — never `/lime-next`**.
- The `LIME_SESSION_CONTEXT` file shape is unchanged: `{ identifier, statusName, title, project, labels }`. **No lime-repo change is required** — this reuses the existing contract.
- Custom session ids are random-suffixed (`customSessionName(slug, genId())`) → never deduplicated; a ticket may have a lime session and one+ custom sessions at once.
- Verification command for every server task: `npx tsc --noEmit && npx vitest run`.
- Work happens in the worktree `/Users/ricventu/code/Lime/mojito/.worktrees/ricventu/ric-128-creazione-di-sessione-custom-da-un-ticket` on branch `ricventu/ric-128-creazione-di-sessione-custom-da-un-ticket`. Never commit to `main`.

---

### Task 1: `buildCustomClaudeCommand` — optional `LIME_SESSION_CONTEXT` prefix

**Files:**
- Modify: `src/server/launch.ts` (function `buildCustomClaudeCommand`, currently lines 115-118)
- Test: `tests/server/launch.test.ts` (extend the `describe("buildCustomClaudeCommand", …)` block, currently lines 134-140)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string, contextPath?: string): string` — when `contextPath` is given, the returned command is prefixed with `LIME_SESSION_CONTEXT='<contextPath>' `; otherwise unchanged (starts with `claude `). Mirrors `buildClaudeCommand`'s signature.

- [ ] **Step 1: Write the failing tests**

Add to the `describe("buildCustomClaudeCommand", …)` block in `tests/server/launch.test.ts`:

```ts
  it("prefixes LIME_SESSION_CONTEXT when a context path is given", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" },
      "/s/x.json", "/state/context/mojito-custom-ric-128-abc123.json");
    expect(cmd).toMatch(/^LIME_SESSION_CONTEXT='\/state\/context\/mojito-custom-ric-128-abc123.json' claude /);
    expect(cmd).not.toContain("/lime-next");
  });

  it("omits LIME_SESSION_CONTEXT when no context path is given", () => {
    const cmd = buildCustomClaudeCommand({ projectName: null, model: "opus", effort: "high" }, "/s/x.json");
    expect(cmd).not.toContain("LIME_SESSION_CONTEXT");
    expect(cmd.startsWith("claude ")).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/launch.test.ts -t buildCustomClaudeCommand`
Expected: the "prefixes LIME_SESSION_CONTEXT" test FAILS (no prefix produced; `contextPath` arg ignored).

- [ ] **Step 3: Implement the optional context prefix**

Replace `buildCustomClaudeCommand` in `src/server/launch.ts`:

```ts
export function buildCustomClaudeCommand(req: CustomLaunchRequest, settingsPath: string, contextPath?: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const envPrefix = contextPath ? `LIME_SESSION_CONTEXT=${q(contextPath)} ` : "";
  return `${envPrefix}claude --model ${q(req.model)} --effort ${q(req.effort)} --settings ${q(settingsPath)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/launch.test.ts -t buildCustomClaudeCommand`
Expected: PASS (both new tests plus the existing "builds a bare claude command" test).

- [ ] **Step 5: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(mojito): optional LIME_SESSION_CONTEXT prefix on bare claude command (RIC-128)"
```

---

### Task 2: `launchCustomSession` — ticket-scoped launch (worktree cwd + context file)

**Files:**
- Modify: `src/server/launch.ts` (interface `CustomLaunchRequest` lines 109-113; function `launchCustomSession` lines 120-168)
- Test: `tests/server/launch.test.ts` (extend `customDeps` factory lines 120-132 and the `describe("launchCustomSession", …)` block)

**Interfaces:**
- Consumes: `buildCustomClaudeCommand(req, settingsPath, contextPath?)` from Task 1; the existing module-local `defaultResolveCwd(projectsPath)` (lines 39-46); `deps.resolveCwd?` (already on `LaunchDeps`, line 35); `writeLaunchContext(stateDir, id, ctx)`; `customSessionName`, `statusSlug` from `./sessionKey.js`; `basename` (already imported).
- Produces:
  - `CustomLaunchRequest` gains optional `ticket?: string; status?: string; title?: string; labels?: string[]`.
  - `launchCustomSession(req, deps)` — when `req.ticket` is set, resolves cwd via `deps.resolveCwd ?? defaultResolveCwd(deps.projectsPath)`, ids the session `mojito-custom-<ticket-slug>-<genId>`, writes a context file, and carries `ticket`/`title`/`labels` onto the meta. Return type unchanged: `{ ok: true; meta } | { ok: false; reason: "no-repo" }`.

- [ ] **Step 1: Extend the `customDeps` test factory to allow a `resolveCwd` stub**

In `tests/server/launch.test.ts`, add a `resolveCwd` default to `customDeps` (so ticket-scoped tests can stub it, matching the `deps` factory at lines 18-28):

```ts
function customDeps(over: Record<string, unknown> = {}) {
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "test-token",
    projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async () => {}),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => "/code/Lime/mojito/.worktrees/ricventu/ric-128-x",
    nowIso: () => "2026-07-11T00:00:00.000Z",
    genId: () => "abc123",
    homeDir: () => "/home/me",
    ...over,
  };
}
```

Note: the existing project-scoped tests (`General …`, `a mapped project …`) do not pass `ticket`, so they ignore `resolveCwd` — they must keep passing unchanged.

- [ ] **Step 2: Write the failing ticket-scoped tests**

Add a new describe block at the end of `tests/server/launch.test.ts`:

```ts
describe("launchCustomSession from a ticket (RIC-128)", () => {
  const ticketReq = { projectName: "Mojito", model: "opus", effort: "high" as const,
    ticket: "RIC-128", status: "Todo", title: "Custom session from a ticket", labels: ["Feature"] };

  it("opens in the ticket's worktree and carries ticket/title/labels on the meta", async () => {
    const d = customDeps({ resolveCwd: () => "/wt/ric-128" });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    const meta = (res as { ok: true; meta: SessionMeta }).meta;
    expect(meta).toMatchObject({ kind: "custom", id: "mojito-custom-ric-128-abc123",
      ticket: "RIC-128", launchStatus: "", cwd: "/wt/ric-128", projectName: "Mojito",
      title: "Custom session from a ticket", labels: ["Feature"], autoAdvance: false });
  });

  it("writes a launch-context file and prefixes LIME_SESSION_CONTEXT (no /lime-next)", async () => {
    const { readFileSync } = await import("node:fs");
    const d = customDeps({ resolveCwd: () => "/wt/ric-128" });
    await launchCustomSession(ticketReq, d);
    const p = join(dir, "context", "mojito-custom-ric-128-abc123.json");
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
      identifier: "RIC-128", statusName: "Todo",
      title: "Custom session from a ticket", project: "Mojito", labels: ["Feature"],
    });
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-ric-128-abc123", "/wt/ric-128",
      expect.stringMatching(/^LIME_SESSION_CONTEXT='[^']+' claude /));
    expect(d.newSession).toHaveBeenCalledWith("mojito-custom-ric-128-abc123", "/wt/ric-128",
      expect.not.stringContaining("/lime-next"));
  });

  it("falls back to the repo root when no worktree exists", async () => {
    const d = customDeps({ resolveCwd: () => "/code/Lime/mojito" });
    const res = await launchCustomSession(ticketReq, d);
    expect(res.ok).toBe(true);
    expect((res as { ok: true; meta: SessionMeta }).meta.cwd).toBe("/code/Lime/mojito");
  });

  it("refuses when the ticket's team/project is unmapped", async () => {
    const d = customDeps({ resolveCwd: () => null });
    const res = await launchCustomSession(ticketReq, d);
    expect(res).toMatchObject({ ok: false, reason: "no-repo" });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/server/launch.test.ts -t "from a ticket"`
Expected: FAIL — `launchCustomSession` currently ignores `ticket`, so ids/cwd/context assertions fail (and TypeScript flags the unknown `ticket`/`status`/`title`/`labels` fields).

- [ ] **Step 4: Extend `CustomLaunchRequest` and `launchCustomSession`**

In `src/server/launch.ts`, replace the interface (lines 109-113):

```ts
export interface CustomLaunchRequest {
  projectName: string | null;
  model: string;
  effort: Effort;
  // Ticket-scoped custom session (RIC-128). When `ticket` is set, cwd resolves through the
  // ticket→worktree chain and a launch-context file is written. Absent = project-scoped (RIC-115).
  ticket?: string;
  status?: string;
  title?: string;
  labels?: string[];
}
```

Replace `launchCustomSession` (lines 120-168) with:

```ts
export async function launchCustomSession(
  req: CustomLaunchRequest,
  deps: LaunchDeps & { genId?: () => string; homeDir?: () => string },
): Promise<{ ok: true; meta: SessionMeta } | { ok: false; reason: "no-repo" }> {
  const homeDir = deps.homeDir ?? (() => homedir());
  const genId = deps.genId ?? (() => randomBytes(3).toString("hex"));

  // cwd + id + slug differ for a ticket-scoped launch vs a project-scoped one.
  let cwd: string;
  let slug: string;
  if (req.ticket) {
    // Same resolver the lime path uses: worktree if one exists for the ticket, else repo root.
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

  const id = customSessionName(slug, genId());

  const settingsDir = join(deps.stateDir, "settings");
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDir, `${id}.json`);
  writeFileSync(settingsPath, JSON.stringify(buildHookSettings(id, deps.port, deps.token), null, 2), { mode: 0o600 });
  chmodSync(settingsPath, 0o600); // mode on writeFileSync is ignored if the file pre-existed

  // Ticket-scoped custom sessions get a launch-context file so a later /lime-next can read it;
  // project-scoped custom sessions run fully bare (no context file).
  const contextPath = req.ticket
    ? writeLaunchContext(deps.stateDir, id, {
        identifier: req.ticket,
        statusName: req.status ?? "",
        title: req.title ?? "",
        project: req.projectName,
        labels: req.labels ?? [],
      })
    : undefined;

  const command = buildCustomClaudeCommand(req, settingsPath, contextPath);
  await deps.newSession(id, cwd, command);
  await deps.pipePane(id, logfilePath(deps.stateDir, id));

  const title = req.ticket ? (req.title ?? basename(cwd)) : cwd === homeDir() ? "home" : basename(cwd);
  const meta: SessionMeta = {
    kind: "custom",
    id,
    ticket: req.ticket ?? "",
    launchStatus: "",
    model: req.model,
    effort: req.effort,
    autoAdvance: false,
    state: "starting",
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

- [ ] **Step 5: Run the full test file to verify pass + no regression**

Run: `npx vitest run tests/server/launch.test.ts`
Expected: PASS — the four new "from a ticket" tests pass, and every pre-existing `launchCustomSession` test (`General …`, `a mapped project …`, `writes hook settings but NO launch-context file`, `refuses an unmapped project`, `registers the session`) still passes.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/launch.ts tests/server/launch.test.ts
git commit -m "feat(mojito): launch a ticket-scoped custom session in the ticket worktree (RIC-128)"
```

---

### Task 3: API route forwards the ticket fields

**Files:**
- Modify: `src/app/api/sessions/route.ts` (the `body.kind === "custom"` branch, currently lines 23-31)

**Interfaces:**
- Consumes: `launchCustomSession` extended in Task 2.
- Produces: the `POST /api/sessions` custom branch now forwards `ticket`, `status`, `title`, `labels`. No new return codes. Backward-compatible: a payload without `ticket` (NewSessionSheet) is a project-scoped custom session exactly as before.

- [ ] **Step 1: Forward the ticket fields**

In `src/app/api/sessions/route.ts`, replace the custom-branch `launchCustomSession(...)` request object (line 25) so it passes the ticket fields through:

```ts
  if (body.kind === "custom") {
    const res = await launchCustomSession(
      { projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high",
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

(Spreading the ticket fields only when `body.ticket` is a non-empty string keeps the project-scoped path byte-for-byte behavior-identical: no `ticket` key means `req.ticket` is `undefined`, so `launchCustomSession` takes its project/home branch and writes no context file.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the request object matches `CustomLaunchRequest`).

- [ ] **Step 3: Verify the underlying behavior is covered**

No route-level unit-test harness exists in this repo (tests are server-unit under `tests/server/`). The forwarded fields are exercised end-to-end by Task 2's launch tests (which assert on `launchCustomSession`'s handling of exactly these fields) and by the manual app check in Task 5. Confirm `npx vitest run` still passes:

Run: `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sessions/route.ts
git commit -m "feat(mojito): forward ticket fields on custom-session launch route (RIC-128)"
```

---

### Task 4: LaunchSheet — "Custom session" button in every state (incl. To QA)

**Files:**
- Modify: `src/components/LaunchSheet.tsx` (currently lines 1-99)

**Interfaces:**
- Consumes: the extended `POST /api/sessions` custom branch (Task 3). Uses the component's existing `model`/`effort` state, `apiFetch`, `onLaunched`, `onClose`, `setErr`, and `ticket: TicketSummary`.
- Produces: a `startCustom()` helper and a "Custom session" button rendered in all three sheet branches (To QA, existing-active, and the normal launch branch), with model/effort selectors visible in each.

- [ ] **Step 1: Add the `startCustom` helper**

In `src/components/LaunchSheet.tsx`, immediately after the `start` helper (after line 55), add:

```tsx
  // Launch a bare, ticket-scoped custom session (RIC-128). Opens in the ticket's worktree if one
  // exists (else the repo root). Custom ids are random-suffixed, so no need to clear an existing one.
  const startCustom = async () => {
    const res = await apiFetch(token, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ kind: "custom", ticket: ticket.identifier, status: ticket.statusName,
        projectName: ticket.project, title: ticket.title, labels: ticket.labels, model, effort }),
    });
    if (!res.ok) { setErr(await res.text()); return; }
    onLaunched();
    onClose();
  };
```

- [ ] **Step 2: Factor the selectors + custom button into reusable JSX and render them in every branch**

Replace the returned JSX body (lines 60-98) so the model/effort selectors and a "Custom session" button appear in all branches. Define the two reusable fragments just before the `return`, then reference them:

```tsx
  const selectors = (
    <div className="two">
      <label className="field"><span className="lbl">Model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="field"><span className="lbl">Effort</span>
        <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
    </div>
  );
  const customBtn = (
    <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => startCustom()}>Custom session</button>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3><span className="id" style={{ fontSize: 16 }}>{ticket.identifier}</span> <span className="chip">{ticket.statusName}</span></h3>
        {ticket.title && <p className="sheet-title">{ticket.title}</p>}
        {isToQa ? (
          <>
            <QaVerdictButtons onApprove={() => submitVerdict("approve")} onReject={(reason) => submitVerdict("reject", reason)} />
            {selectors}
            {customBtn}
          </>
        ) : existingActive ? (
          <>
            <button className="btn primary block" onClick={() => onOpen(existing!)}>Open running session</button>
            {selectors}
            {customBtn}
          </>
        ) : (
          <>
            {existing && (
              <button className="btn ghost block" style={{ marginBottom: 12 }} onClick={() => onOpen(existing)}>
                Open session (<StateBadge state={existing.state} />)
              </button>
            )}
            {selectors}
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
            </label>
            {isToMerge ? (
              <div className="btns">
                <button className="btn primary" onClick={() => start("local")}>Start · local</button>
                <button className="btn primary" onClick={() => start("mr")}>Start · mr</button>
              </div>
            ) : (
              <button className="btn primary block" onClick={() => start()}>{existing ? "Start new session" : "Start session"}</button>
            )}
            {customBtn}
          </>
        )}
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/LaunchSheet.tsx
git commit -m "feat(mojito): Custom session button in LaunchSheet for every ticket state (RIC-128)"
```

---

### Task 5: Full verification + manual app check

**Files:** none (verification only).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: confirmation the feature works end-to-end.

- [ ] **Step 1: Full typecheck + test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, no type errors. The tmux integration test is skipped when `tmux` is unavailable — that is expected.

- [ ] **Step 2: Drive the app to confirm the button works**

Use the `verify` skill (or `run`) to launch the Mojito dev server against a state dir, open a ticket's LaunchSheet, click **Custom session**, and confirm:
- a new session card of kind `custom` appears carrying the ticket title;
- its tmux command (inspect `~/.mojito-state/logs/<id>.log` or the spawned command) starts with `LIME_SESSION_CONTEXT='…' claude ` and contains no `/lime-next`;
- when a worktree exists for the ticket, the session's `cwd` is that worktree; otherwise it is the mapped repo root;
- the button is present at To QA as well as the other states.

**Do not run the dev server or a build from the main checkout** — the live dev server on `:8700` shares `.next` with the main checkout. Run against the worktree with an isolated `MOJITO_STATE_DIR` if needed.

- [ ] **Step 3: Confirm no lime-repo change is needed**

RIC-128 reuses the `LIME_SESSION_CONTEXT` contract unchanged (same five fields), so no edit to `/Users/ricventu/code/Lime/lime` is required. Note this in the completion report; do not touch the lime repo.

## Self-Review

**1. Spec coverage:**
- Worktree-else-repo-root cwd → Task 2 (Step 4 `if (req.ticket)` branch, `resolveCwd`). ✓
- `LIME_SESSION_CONTEXT` written, bare claude no `/lime-next` → Task 1 (prefix) + Task 2 (context file). ✓
- API passthrough, backward-compatible → Task 3. ✓
- "Custom session" button in every state incl. To QA → Task 4. ✓
- Tests: worktree resolve, repo-root fallback, unmapped no-repo, project-scoped unchanged → Task 2 Steps 2/5. ✓
- Non-goal (no worktree creation) → honored: cwd falls back, never creates. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; no "handle edge cases" hand-waving. ✓

**3. Type consistency:** `CustomLaunchRequest` optional fields (`ticket`/`status`/`title`/`labels`) are used identically in Task 2's function body, Task 3's route object, and Task 4's POST body. `buildCustomClaudeCommand(req, settingsPath, contextPath?)` signature is defined in Task 1 and called in Task 2. `writeLaunchContext` ctx shape matches `LaunchContext` (`{ identifier, statusName, title, project, labels }`). ✓
