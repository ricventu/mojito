# Push in the Stacks panel (RIC-169) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Push button to every row of the Mojito Stacks panel (pushing the branch checked out at the mapped repo path), plus a guarded "Pull & deploy" button on the Mojito self-row.

**Architecture:** A stateless `gitPush(cwd, run?)` helper mirrors the existing `ffPull(cwd, run?)`; `projectStack.ts` wraps it in the same per-slug single-flight it already uses for pull and exposes `pushStack`; a new `POST /api/stacks/[slug]/push` route mirrors the pull route. On the client, a pure `pushMessage()` sibling of `pullMessage()` renders the outcome, and the Settings sheet's self-update behavior moves into a shared `useSelfUpdate` hook so the Stacks self-row can reuse it instead of pointing a raw `git pull` at Mojito's own checkout.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, vitest (node environment, no React Testing Library), git via `execFile`.

**Spec:** `docs/superpowers/specs/2026-08-09-ric-169-stacks-push-design.md`

## Global Constraints

- All code artifacts in English — identifiers, comments, log/error strings.
- Never invoke git through a shell: `execFile("git", [...])` only, no interpolation.
- Never `--force` / `--force-with-lease` on the push path.
- `LC_ALL=C` on every git invocation whose output is parsed (English markers).
- Verification command for every task: `npx tsc --noEmit && npx vitest run`.
- Follow existing file conventions: server modules import siblings with a `.js` suffix
  (`./gitPush.js`), tests import through the `@/` alias (`@/server/gitPush`).
- Commit after each task. Tests live in `tests/` mirroring `src/`.

---

### Task 1: `gitPush` helper

**Files:**
- Create: `src/server/gitPush.ts`
- Test: `tests/server/gitPush.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; mirrors `src/server/ffPull.ts`).
- Produces: `gitPush(cwd: string, run?: GitRun): Promise<GitPushResult>`;
  `interface GitPushResult { status: "pushed" | "up-to-date"; branch: string; from: string; to: string }`;
  `class GitPushError extends Error { kind: "detached" | "rejected" | "failed"; detail: string }`;
  `type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/gitPush.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gitPush, GitPushError, type GitRun } from "@/server/gitPush";

// A fake runner: `branch` is what `rev-parse --abbrev-ref HEAD` reports; `remote`
// answers each `rev-parse --short origin/<branch>` (call 1 = before the push, call 2 =
// after); `push` decides what `git push` does. Every invocation is recorded in `calls`.
function fakeRun(opts: {
  branch?: string;
  remote?: (call: number) => Promise<string>;
  push?: () => Promise<void>;
  calls?: string[][];
}): GitRun {
  let remoteCalls = 0;
  return async (args) => {
    opts.calls?.push(args);
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
      return { stdout: `${opts.branch ?? "main"}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse") {
      remoteCalls += 1;
      const sha = await (opts.remote ?? (() => Promise.resolve("aaaaaaa")))(remoteCalls);
      return { stdout: `${sha}\n`, stderr: "" };
    }
    if (args[0] === "push") {
      await (opts.push ?? (() => Promise.resolve()))();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const shas = (before: string, after: string) => (call: number) =>
  Promise.resolve(call === 1 ? before : after);
function gitFail(stderr: string) {
  return () => Promise.reject(Object.assign(new Error("git failed"), { stderr }));
}

describe("gitPush", () => {
  it("reports pushed when the remote ref moves", async () => {
    const res = await gitPush("/repo", fakeRun({ remote: shas("aaaaaaa", "bbbbbbb") }));
    expect(res).toEqual({ status: "pushed", branch: "main", from: "aaaaaaa", to: "bbbbbbb" });
  });

  it("reports up-to-date when the remote ref is unchanged", async () => {
    const res = await gitPush("/repo", fakeRun({ remote: shas("aaaaaaa", "aaaaaaa") }));
    expect(res).toEqual({ status: "up-to-date", branch: "main", from: "aaaaaaa", to: "aaaaaaa" });
  });

  it("treats a branch with no remote counterpart as a new remote branch", async () => {
    const remote = (call: number) =>
      call === 1
        ? Promise.reject(new Error("fatal: ambiguous argument 'origin/main'"))
        : Promise.resolve("bbbbbbb");
    const res = await gitPush("/repo", fakeRun({ remote }));
    expect(res).toEqual({ status: "pushed", branch: "main", from: "", to: "bbbbbbb" });
  });

  it("pushes the checked-out branch by name and never forces", async () => {
    const calls: string[][] = [];
    await gitPush("/repo", fakeRun({ branch: "feature/x", remote: shas("a", "b"), calls }));
    expect(calls).toContainEqual(["push", "origin", "feature/x"]);
    expect(calls.flat().some((a) => a.startsWith("--force"))).toBe(false);
  });

  it("refuses a detached HEAD without pushing", async () => {
    const calls: string[][] = [];
    const err = await gitPush("/repo", fakeRun({ branch: "HEAD", calls })).catch((e) => e);
    expect(err).toBeInstanceOf(GitPushError);
    expect(err.kind).toBe("detached");
    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("maps a non-fast-forward refusal to rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"),
    });
    await expect(gitPush("/repo", run)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("maps the 'Updates were rejected' hint to rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail("hint: Updates were rejected because the remote contains work that you do"),
    });
    await expect(gitPush("/repo", run)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("maps a protected-branch [remote rejected] to failed, not rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail(" ! [remote rejected] main -> main (protected branch hook declined)"),
    });
    const err = await gitPush("/repo", run).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("protected branch");
  });

  it("maps any other git failure to failed and keeps an output snippet", async () => {
    const run = fakeRun({ remote: shas("a", "a"), push: gitFail("fatal: could not read Username") });
    const err = await gitPush("/repo", run).catch((e) => e);
    expect(err).toBeInstanceOf(GitPushError);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("could not read Username");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/gitPush.test.ts`
Expected: FAIL — cannot resolve `@/server/gitPush`.

- [ ] **Step 3: Write the implementation**

Create `src/server/gitPush.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

export interface GitPushResult {
  status: "pushed" | "up-to-date";
  branch: string;
  from: string; // short SHA of origin/<branch> before the push; "" when it did not exist
  to: string; // short SHA of origin/<branch> after the push
}

export class GitPushError extends Error {
  constructor(public readonly kind: "detached" | "rejected" | "failed", public readonly detail: string) {
    super(`git push ${kind}: ${detail}`);
    this.name = "GitPushError";
  }
}

// LC_ALL=C pins git's output to English so the markers below match a localized
// environment too (mirrors ffPull.ts). 60s covers a slow push; maxBuffer prevents
// ENOBUFS from misreporting a push that actually landed.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 60_000, encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 });

// A server-side hook declining the push (protected branch). Checked FIRST: this text
// also contains "rejected", but pulling would not help, so it must never be classified
// as a non-fast-forward.
const REMOTE_REJECTED_MARKER = "[remote rejected]";
// Markers git prints when the push is refused because origin is ahead.
const REJECTED_MARKERS = ["[rejected]", "Updates were rejected"];

// git splits push output across stdout and stderr, so classification and detail both
// read the combination (mirrors merge.ts's outputOf).
function outputOf(e: unknown): string {
  if (e && typeof e === "object") {
    const stdout = "stdout" in e && typeof (e as { stdout?: unknown }).stdout === "string" ? (e as { stdout: string }).stdout : "";
    const stderr = "stderr" in e && typeof (e as { stderr?: unknown }).stderr === "string" ? (e as { stderr: string }).stderr : "";
    if (stdout || stderr) return `${stdout}\n${stderr}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// The remote-tracking ref, or "" when it does not exist yet (a branch never pushed).
async function remoteSha(branch: string, cwd: string, run: GitRun): Promise<string> {
  try {
    return (await run(["rev-parse", "--short", `origin/${branch}`], cwd)).stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Push the branch checked out at `cwd` to origin. Stateless: single-flight is the
 * caller's responsibility, as with ffPull. Never forces — a push that cannot
 * fast-forward is surfaced as `rejected`, not resolved.
 */
export async function gitPush(cwd: string, run: GitRun = defaultRun): Promise<GitPushResult> {
  const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).stdout.trim();
  if (!branch || branch === "HEAD") throw new GitPushError("detached", "repo is on a detached HEAD");
  const from = await remoteSha(branch, cwd, run);
  try {
    await run(["push", "origin", branch], cwd);
  } catch (e) {
    const out = outputOf(e);
    const kind = !out.includes(REMOTE_REJECTED_MARKER) && REJECTED_MARKERS.some((m) => out.includes(m))
      ? "rejected"
      : "failed";
    throw new GitPushError(kind, out.trim().slice(0, 500));
  }
  const to = await remoteSha(branch, cwd, run);
  // `git push` updates the remote-tracking ref itself, so an unchanged SHA means there
  // was nothing to push. A branch with no remote counterpart is always a real push.
  return { status: from !== "" && from === to ? "up-to-date" : "pushed", branch, from, to };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run tests/server/gitPush.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/gitPush.ts tests/server/gitPush.test.ts
git commit -m "feat(git): gitPush helper for a non-forcing push of the checked-out branch"
```

---

### Task 2: `pushStack` and the `self` row flag

**Files:**
- Modify: `src/server/projectStack.ts`
- Modify: `src/lib/stacks.ts` (add `self` to `StackRow`)
- Test: `tests/server/projectStack.test.ts` (extend)

**Interfaces:**
- Consumes: `gitPush`, `GitPushError`, `GitPushResult` from Task 1.
- Produces: `pushStack(slug: string, deps: StackDeps): Promise<StackPushResult>` where
  `type StackPushResult = { ok: true; result: GitPushResult } | { ok: false; error: string; code: number; detail?: string }`;
  `StackDeps.push?: (cwd: string) => Promise<GitPushResult>`;
  `StackTarget.self: boolean` and `StackRow.self: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/projectStack.test.ts` (and extend the existing import line at the
top to `import { listStacks, resolveStack, startStack, stopStack, pullStack, pushStack, _resetStackInflight, type StackDeps, type PaneInfo } from "@/server/projectStack";`
plus `import { GitPushError, type GitPushResult } from "@/server/gitPush";`):

```ts
describe("pushStack", () => {
  const pushed: GitPushResult = { status: "pushed", branch: "main", from: "aaa", to: "bbb" };

  it("404 for an unknown slug", async () => {
    expect(await pushStack("nope", deps())).toEqual({ ok: false, error: "unknown stack", code: 404 });
  });

  it("returns the push result for a mapped project", async () => {
    expect(await pushStack("factorybook", deps({ push: async () => pushed })))
      .toEqual({ ok: true, result: pushed });
  });

  it("pushes the Mojito self-row, unlike pull", async () => {
    const seen: string[] = [];
    const res = await pushStack("mojito", deps({ push: async (cwd) => { seen.push(cwd); return pushed; } }));
    expect(res).toEqual({ ok: true, result: pushed });
    expect(seen).toEqual([SELF]);
  });

  it("maps rejected to 409 and every other kind to 500", async () => {
    const rejected = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("rejected", "! [rejected] main -> main"); },
    }));
    expect(rejected).toMatchObject({ ok: false, error: "rejected", code: 409 });
    _resetStackInflight();
    const detached = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("detached", "repo is on a detached HEAD"); },
    }));
    expect(detached).toMatchObject({ ok: false, error: "detached", code: 500 });
    _resetStackInflight();
    const failed = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("failed", "could not read Username"); },
    }));
    expect(failed).toMatchObject({ ok: false, error: "failed", code: 500, detail: "could not read Username" });
  });

  it("single-flights concurrent pushes for the same slug", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({ push: async () => { calls += 1; await gate; return pushed; } });
    const p1 = pushStack("factorybook", d);
    const p2 = pushStack("factorybook", d);
    release();
    expect(await p1).toEqual({ ok: true, result: pushed });
    expect(await p2).toEqual({ ok: true, result: pushed });
    expect(calls).toBe(1);
  });
});
```

Also extend the existing listing test — in `it("flags the Mojito self-row (path === selfPath) as not pullable", ...)` add:

```ts
    expect(mojito.self).toBe(true);
    const fb = rows.find((r) => r.project === "Factorybook")!;
    expect(fb.self).toBe(false);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/projectStack.test.ts`
Expected: FAIL — `pushStack` is not exported; `self` is undefined on the rows.

- [ ] **Step 3: Write the implementation**

In `src/lib/stacks.ts`, add the field to `StackRow`:

```ts
export interface StackRow {
  project: string;
  slug: string;
  hasStack: boolean;
  status: StackStatus | null; // meaningful only when hasStack
  pullable: boolean; // false for the Mojito self-row
  self: boolean; // the Mojito checkout this server runs from
}
```

In `src/server/projectStack.ts`:

1. Extend the imports:

```ts
import { gitPush, GitPushError, type GitPushResult } from "./gitPush.js";
```

2. Add the dependency seam and the target flag:

```ts
export interface StackDeps {
  // …existing fields…
  pull?: (cwd: string) => Promise<FfPullResult>;
  push?: (cwd: string) => Promise<GitPushResult>;
}

export interface StackTarget {
  project: string;
  path: string;
  hasStack: boolean;
  pullable: boolean;
  self: boolean;
}
```

3. Set `self` where `pullable` is already computed — in `resolveStack`'s return
   (`self: resolve(match.path) === resolve(deps.selfPath)`) and in `listStacks`'s row
   (`self: resolve(path) === resolve(deps.selfPath)`).

4. Replace the inline single-flight in `pullStack` with a shared helper, and reuse it for
   push (the pull tests already cover the dedup, so they protect this refactor):

```ts
const pullInflight = new Map<string, Promise<FfPullResult>>();
const pushInflight = new Map<string, Promise<GitPushResult>>();

export function _resetStackInflight(): void {
  pullInflight.clear();
  pushInflight.clear();
}

// One in-flight git operation per slug: a second POST while one runs gets its result.
function singleFlight<T>(map: Map<string, Promise<T>>, slug: string, op: () => Promise<T>): Promise<T> {
  const running = map.get(slug);
  if (running) return running;
  const started = (async () => {
    try {
      return await op();
    } finally {
      map.delete(slug);
    }
  })();
  map.set(slug, started);
  return started;
}
```

`pullStack`'s body becomes:

```ts
  try {
    return { ok: true, result: await singleFlight(pullInflight, slug, () => pull(target.path)) };
  } catch (e) {
```

(the `catch` block is unchanged).

5. Add `pushStack`:

```ts
export type StackPushResult =
  | { ok: true; result: GitPushResult }
  | { ok: false; error: string; code: number; detail?: string };

/**
 * Push the mapped checkout's current branch. Unlike pull, the Mojito self-row IS
 * pushable: a push mutates no working tree and fires no local hook, so the post-merge
 * deploy hazard that makes the self-row unpullable does not apply here.
 */
export async function pushStack(slug: string, deps: StackDeps): Promise<StackPushResult> {
  const target = resolveStack(slug, deps);
  if (!target) return { ok: false, error: "unknown stack", code: 404 };
  const push = deps.push ?? ((cwd: string) => gitPush(cwd));
  try {
    return { ok: true, result: await singleFlight(pushInflight, slug, () => push(target.path)) };
  } catch (e) {
    if (e instanceof GitPushError) {
      return { ok: false, error: e.kind, code: e.kind === "rejected" ? 409 : 500, detail: e.detail };
    }
    return { ok: false, error: "failed", code: 500, detail: String(e) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run tests/server/projectStack.test.ts`
Expected: PASS. `tsc` will also flag any other construction of a `StackRow` that now needs
`self` — fix those by computing the flag the same way, never by widening the type.

- [ ] **Step 5: Commit**

```bash
git add src/server/projectStack.ts src/lib/stacks.ts tests/server/projectStack.test.ts
git commit -m "feat(stacks): pushStack with per-slug single-flight and a self row flag"
```

---

### Task 3: `POST /api/stacks/[slug]/push`

**Files:**
- Create: `src/app/api/stacks/[slug]/push/route.ts`
- Test: `tests/server/stacksRoute.test.ts` (extend)

**Interfaces:**
- Consumes: `pushStack` / `StackPushResult` from Task 2.
- Produces: the HTTP contract — 200 `{status, branch, from, to}`, 409 `{error:"rejected", detail}`,
  500 `{error:"detached"|"failed", detail}`, 404 unknown slug, 401 without token.

- [ ] **Step 1: Write the failing tests**

In `tests/server/stacksRoute.test.ts`: add `pushStack: vi.fn(),` to the
`vi.mock("@/server/projectStack", …)` factory, add
`import { POST as PUSH } from "@/app/api/stacks/[slug]/push/route";` next to the other route
imports, add `pushStack` to the `import { … } from "@/server/projectStack";` list, and append:

```ts
function pushReq(slug: string, auth = true): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/stacks/${slug}/push`, { method: "POST", headers: auth ? { "x-mojito-token": TOKEN } : {} }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe("POST /api/stacks/[slug]/push", () => {
  it("401 without token", async () => {
    expect((await PUSH(...pushReq("factorybook", false))).status).toBe(401);
  });
  it("200 returns the push result at top level", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: true, result: { status: "pushed", branch: "main", from: "a", to: "b" } });
    const res = await PUSH(...pushReq("factorybook"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pushed", branch: "main", from: "a", to: "b" });
  });
  it("404 for an unknown slug", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "unknown stack", code: 404 });
    expect((await PUSH(...pushReq("nope"))).status).toBe(404);
  });
  it("409 rejected with detail", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "rejected", code: 409, detail: "! [rejected] main -> main" });
    const res = await PUSH(...pushReq("factorybook"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "rejected", detail: "! [rejected] main -> main" });
  });
  it("500 failed", async () => {
    vi.mocked(pushStack).mockResolvedValue({ ok: false, error: "failed", code: 500, detail: "could not read Username" });
    expect((await PUSH(...pushReq("factorybook"))).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/stacksRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/stacks/[slug]/push/route`.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/stacks/[slug]/push/route.ts` (byte-for-byte the pull route's shape):

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { pushStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await pushStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (r.ok) return NextResponse.json(r.result, { status: 200 });
  return NextResponse.json(r.detail ? { error: r.error, detail: r.detail } : { error: r.error }, { status: r.code });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run tests/server/stacksRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stacks/[slug]/push/route.ts tests/server/stacksRoute.test.ts
git commit -m "feat(api): POST /api/stacks/[slug]/push"
```

---

### Task 4: `pushMessage` and the Push button

**Files:**
- Modify: `src/lib/stacks.ts`
- Modify: `src/components/StacksPanel.tsx`
- Test: `tests/lib/stacks.test.ts` (extend)

**Interfaces:**
- Consumes: the `/push` HTTP contract from Task 3; `StackRow.self` from Task 2.
- Produces: `type PushResponse`; `pushMessage(res: PushResponse): { kind: "ok" | "err"; text: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/stacks.test.ts` (extend its import to
`import { pullMessage, pushMessage, syntheticStackSession } from "@/lib/stacks";`):

```ts
describe("pushMessage", () => {
  it("pushed -> ok with branch and from/to", () => {
    expect(pushMessage({ status: "pushed", branch: "main", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Pushed main aaa → bbb." });
  });
  it("pushed with no previous remote ref -> ok naming it a new branch", () => {
    expect(pushMessage({ status: "pushed", branch: "main", from: "", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Pushed main (new remote branch)." });
  });
  it("up-to-date -> ok", () => {
    expect(pushMessage({ status: "up-to-date", branch: "main", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Nothing to push (main at aaa)." });
  });
  it("rejected -> err pointing at Pull", () => {
    const m = pushMessage({ error: "rejected", detail: "! [rejected] main -> main" });
    expect(m.kind).toBe("err");
    expect(m.text).toMatch(/Pull first/);
    expect(m.text).toContain("! [rejected] main -> main");
  });
  it("detached -> err", () => {
    expect(pushMessage({ error: "detached", detail: "repo is on a detached HEAD" }))
      .toEqual({ kind: "err", text: "Repo is on a detached HEAD — nothing to push." });
  });
  it("failed -> err with the detail", () => {
    expect(pushMessage({ error: "failed", detail: "could not read Username" }))
      .toEqual({ kind: "err", text: "Push failed — could not read Username" });
  });
  it("failed with no detail -> err", () => {
    expect(pushMessage({ error: "failed" })).toEqual({ kind: "err", text: "Push failed" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/stacks.test.ts`
Expected: FAIL — `pushMessage` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/stacks.ts`, after `pullMessage`:

```ts
export type PushResponse =
  | { status: "pushed" | "up-to-date"; branch: string; from: string; to: string }
  | { error: string; detail?: string };

export function pushMessage(res: PushResponse): { kind: "ok" | "err"; text: string } {
  if ("status" in res) {
    if (res.status === "up-to-date") return { kind: "ok", text: `Nothing to push (${res.branch} at ${res.to}).` };
    return {
      kind: "ok",
      text: res.from ? `Pushed ${res.branch} ${res.from} → ${res.to}.` : `Pushed ${res.branch} (new remote branch).`,
    };
  }
  if (res.error === "detached") return { kind: "err", text: "Repo is on a detached HEAD — nothing to push." };
  const detail = res.detail ? ` — ${res.detail}` : "";
  // A rejected push is a non-fast-forward: the Pull button next to it is the fix, and it
  // already offers "Resolve with Claude" when the history has genuinely diverged.
  const base = res.error === "rejected" ? "origin has commits you don't have — Pull first" : "Push failed";
  return { kind: "err", text: `${base}${detail}` };
}
```

In `src/components/StacksPanel.tsx`: extend the import to
`import { pullMessage, pushMessage, syntheticStackSession, type PullResponse, type PushResponse, type StackRow } from "@/lib/stacks";`,
add the handler next to `pull`:

```tsx
  const push = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/push`, { method: "POST" });
      setMsg({ ...pushMessage((await res.json()) as PushResponse), canResolve: false });
      await refresh();
    } finally { setBusy(false); }
  };
```

and render the button right after the Pull button, on **every** row (no `pullable` guard —
Mojito's own checkout is pushable):

```tsx
        <button className="btn sm ghost" disabled={busy} onClick={push}>Push</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (whole suite).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stacks.ts src/components/StacksPanel.tsx tests/lib/stacks.test.ts
git commit -m "feat(stacks): Push button on every stack row"
```

---

### Task 5: Extract the self-update behavior into a shared hook

**Files:**
- Create: `src/lib/selfUpdate.ts`
- Create: `src/lib/useSelfUpdate.ts`
- Modify: `src/components/SettingsSheet.tsx:14-84` (state, effects and `onPull` are replaced by the hook)
- Test: `tests/lib/selfUpdate.test.ts`

**Interfaces:**
- Consumes: `initialPollState` / `nextPollState` from `src/lib/deployPoll.ts`; `apiFetch` from `src/lib/client.ts`.
- Produces: `selfUpdateMessage(res: SelfUpdateResponse): { kind: "ok" | "err"; text: string }`;
  `useSelfUpdate(token: string): { enabled: boolean; phase: SelfUpdatePhase; message: string | null; error: string | null; run: () => Promise<void> }`
  with `type SelfUpdatePhase = "idle" | "pulling" | "deploying" | "timeout"`.

**Note:** this task must not change any behavior — it is a pure extraction so Task 6 can
reuse it. vitest runs in the `node` environment with no React Testing Library, so the hook
itself is not rendered in tests; the testable seam is the pure `selfUpdateMessage`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/selfUpdate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selfUpdateMessage } from "@/lib/selfUpdate";

describe("selfUpdateMessage", () => {
  it("updated -> ok with from/to", () => {
    expect(selfUpdateMessage({ status: "updated", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Updated aaa → bbb." });
  });
  it("up-to-date -> ok, still redeploying", () => {
    expect(selfUpdateMessage({ status: "up-to-date", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Already up to date (aaa) — redeploying." });
  });
  it("diverged -> err telling the user to use a terminal", () => {
    const m = selfUpdateMessage({ error: "diverged", detail: "Not possible to fast-forward" });
    expect(m.kind).toBe("err");
    expect(m.text).toBe("History diverged — resolve from a terminal — Not possible to fast-forward");
  });
  it("failed -> err with the detail", () => {
    expect(selfUpdateMessage({ error: "failed", detail: "network down" }))
      .toEqual({ kind: "err", text: "Update failed — network down" });
  });
  it("failed with no detail -> err", () => {
    expect(selfUpdateMessage({ error: "failed" })).toEqual({ kind: "err", text: "Update failed" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/selfUpdate.test.ts`
Expected: FAIL — cannot resolve `@/lib/selfUpdate`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/selfUpdate.ts`:

```ts
export type SelfUpdateResponse =
  | { status: "updated" | "up-to-date"; from: string; to: string }
  | { error: string; detail?: string };

// "Pull & deploy" always rebuilds and restarts, so an up-to-date pull still reports a
// redeploy rather than "nothing happened".
export function selfUpdateMessage(res: SelfUpdateResponse): { kind: "ok" | "err"; text: string } {
  if ("status" in res) {
    return res.status === "up-to-date"
      ? { kind: "ok", text: `Already up to date (${res.from}) — redeploying.` }
      : { kind: "ok", text: `Updated ${res.from} → ${res.to}.` };
  }
  const detail = res.detail ? ` — ${res.detail}` : "";
  return res.error === "diverged"
    ? { kind: "err", text: `History diverged — resolve from a terminal${detail}` }
    : { kind: "err", text: `Update failed${detail}` };
}
```

Create `src/lib/useSelfUpdate.ts` — the block currently inline in `SettingsSheet.tsx`,
moved unchanged:

```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import { initialPollState, nextPollState } from "./deployPoll";
import { selfUpdateMessage, type SelfUpdateResponse } from "./selfUpdate";

export type SelfUpdatePhase = "idle" | "pulling" | "deploying" | "timeout";

/**
 * The server's "Pull & deploy" control, shared by the Settings sheet and the Stacks
 * self-row. `enabled` mirrors MOJITO_SELF_UPDATE: when false the server has no
 * /api/self-update endpoint and no caller should render the control.
 */
export function useSelfUpdate(token: string) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<SelfUpdatePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch(token, "/api/self-update")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.enabled === "boolean") setEnabled(b.enabled); })
      .catch(() => { /* leave the control hidden */ });
  }, [token]);

  // Poll /api/health while a deploy is in flight, tied to the caller's lifecycle: if the
  // component unmounts mid-deploy or phase moves away from "deploying", the cleanup
  // cancels the pending tick so no further poll, setPhase, or reload runs after that
  // point — the user then reloads manually (see phase === "timeout").
  useEffect(() => {
    if (phase !== "deploying") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let state = initialPollState;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 5 * 60_000) { setPhase("timeout"); return; }
      let up = false;
      try { up = (await apiFetch(token, "/api/health")).ok; } catch { up = false; }
      if (cancelled) return;
      state = nextPollState(state, up);
      if (state.recovered) { location.reload(); return; }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, token]);

  const run = useCallback(async () => {
    setError(null);
    setMessage(null);
    setPhase("pulling");
    let res: Response;
    try {
      res = await apiFetch(token, "/api/self-update", { method: "POST" });
    } catch {
      setPhase("idle");
      setError("Network error — could not reach the server.");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as SelfUpdateResponse;
    const msg = selfUpdateMessage(body);
    if (res.status === 200 && "status" in body) {
      setMessage(msg.text);
      setPhase("deploying");
      return;
    }
    setPhase("idle");
    setError(msg.text);
  }, [token]);

  return { enabled, phase, message, error, run };
}
```

In `src/components/SettingsSheet.tsx`, delete the `selfUpdateEnabled` / `phase` /
`pullMsg` / `pullErr` state, both self-update `useEffect`s and `onPull`, drop the now-unused
`initialPollState` / `nextPollState` import, and replace them with:

```tsx
import { useSelfUpdate } from "@/lib/useSelfUpdate";
// …
  const { enabled: selfUpdateEnabled, phase, message: pullMsg, error: pullErr, run: onPull } = useSelfUpdate(token);
```

The JSX at `SettingsSheet.tsx:149-167` keeps referring to the same names, so it stays
untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (whole suite, including the untouched `deployPoll` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/selfUpdate.ts src/lib/useSelfUpdate.ts src/components/SettingsSheet.tsx tests/lib/selfUpdate.test.ts
git commit -m "refactor(self-update): extract the Pull & deploy flow into useSelfUpdate"
```

---

### Task 6: "Pull & deploy" on the Stacks self-row

**Files:**
- Modify: `src/components/StacksPanel.tsx`

**Interfaces:**
- Consumes: `useSelfUpdate` from Task 5; `StackRow.self` from Task 2.
- Produces: nothing new — final wiring.

**Note:** no new test — this is JSX wiring, and this suite renders no components (node
environment, `tests/**/*.test.ts`). Its logic already lives in the tested
`selfUpdateMessage` and `deployPoll` helpers. Verify by typecheck plus the manual check in
Step 3.

- [ ] **Step 1: Wire the hook once, at the panel level**

The capability probe must not run once per row, so `useSelfUpdate` is called in
`StacksPanel` and passed down. In `src/components/StacksPanel.tsx`:

```tsx
import { useSelfUpdate } from "@/lib/useSelfUpdate";

type SelfUpdate = ReturnType<typeof useSelfUpdate>;

export default function StacksPanel({ token, onOpenLogs }: { token: string; onOpenLogs: (s: SessionMeta) => void }) {
  const { stacks, refresh } = useStacks(token);
  const selfUpdate = useSelfUpdate(token);
  return (
    <div className="pad">
      <section>
        <h4 className="sect">Stacks</h4>
        {stacks.map((row) => (
          <StackRowView key={row.slug} row={row} token={token} onOpenLogs={onOpenLogs} refresh={refresh} selfUpdate={selfUpdate} />
        ))}
      </section>
    </div>
  );
}
```

and widen the row's props:

```tsx
function StackRowView({ row, token, onOpenLogs, refresh, selfUpdate }: {
  row: StackRow; token: string; onOpenLogs: (s: SessionMeta) => void; refresh: () => void; selfUpdate: SelfUpdate;
}) {
```

- [ ] **Step 2: Render the button and its phase feedback on the self-row only**

Inside `<div className="s-actions">`, after the Push button:

```tsx
        {/* Mojito's own checkout has a post-merge hook that starts the deploy unit, so its
            Pull is the guarded /api/self-update flow (banner + health-poll + reload), not
            the raw stacks pull. Hidden entirely when MOJITO_SELF_UPDATE is off. */}
        {row.self && selfUpdate.enabled && (
          <button
            className="btn sm ghost"
            disabled={busy || selfUpdate.phase === "pulling" || selfUpdate.phase === "deploying"}
            onClick={selfUpdate.run}
          >
            {selfUpdate.phase === "pulling" ? "Pulling…" : selfUpdate.phase === "deploying" ? "Deploying…" : "Pull & deploy"}
          </button>
        )}
```

and after the existing `{msg && …}` line, still inside the row's `<div className="card">`:

```tsx
      {row.self && selfUpdate.message && <p className="sheet-title">{selfUpdate.message}</p>}
      {row.self && selfUpdate.phase === "deploying" && (
        <p className="sheet-title">Deploying — the server restarts in ~1 min…</p>
      )}
      {row.self && selfUpdate.phase === "timeout" && <p className="err-text">Deploy still running — reload manually.</p>}
      {row.self && selfUpdate.error && <p className="err-text">{selfUpdate.error}</p>}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (whole suite).

Then compile the client bundle, the cheapest full check that the panel still builds:

Run: `npx next build`
Expected: build succeeds. If it fails for a reason unrelated to this change (missing env,
sandbox restriction, network), say so in the task report and treat `tsc --noEmit` +
`vitest run` as the gate — do not "fix" unrelated build config in this task.

- [ ] **Step 4: Commit**

```bash
git add src/components/StacksPanel.tsx
git commit -m "feat(stacks): guarded Pull & deploy on the Mojito self-row"
```

---

## Verification

Full gate for the branch, from the worktree root:

```bash
npx tsc --noEmit && npx vitest run
```

Expected: the pre-existing 661 tests plus the ~26 added here, all passing.
