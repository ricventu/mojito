# Self-update "Pull & deploy" button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings-sheet button that fast-forward-pulls Mojito's own server checkout and lets the existing deploy-on-merge hook restart the app.

**Architecture:** A stateless `ffPull(cwd)` core (git `--ff-only` via `execFile`, HEAD before/after) is called by a thin `selfUpdate` wrapper (env gate + module-level single-flight) behind a token-authed `/api/self-update` route (`GET` reports enabled, `POST` runs the pull). The `SettingsSheet` renders a "Server" section only when enabled, shows the pull outcome, and polls `/api/health` for a down-then-up transition (a pure `nextPollState` reducer) before reloading. Deploy itself stays owned by the existing `post-merge` hook.

**Tech Stack:** Next.js (App Router route handlers), TypeScript, React (client component), Node `child_process.execFile` via `promisify`, Vitest.

## Global Constraints

- Tests/verification command: `npx tsc --noEmit && npx vitest run` (run from the worktree root).
- Feature flag: `MOJITO_SELF_UPDATE === "1"` read from `process.env` (set in the server's `.env.local` only). No code writes this value.
- Deploy is owned by the existing `post-merge` git hook → `mojito-deploy.service`. This change adds **no** second deploy pathway; a flag set without the hook installed is explicitly out of scope.
- Fast-forward only: `git pull --ff-only`. A diverged history is reported as an error to resolve manually — **never** an unattended merge, **never** a reset.
- All git invocations go through `execFile` (never a shell) and pin `LC_ALL=C` so English failure markers match — mirrors `src/server/reviewScale.ts:46`.
- Auth on every route: `tokenFromHeaders(req.headers, getConfig().token)`; missing/wrong token → `new NextResponse("unauthorized", { status: 401 })` — mirrors `src/app/api/config/review-scale/route.ts`.
- All identifiers, comments, and log/error strings in English.

---

### Task 1: `ffPull(cwd)` fast-forward core

Stateless git core, reusable by RIC-165's per-project pull. No single-flight here (callers own concurrency).

**Files:**
- Create: `src/server/ffPull.ts`
- Test: `tests/server/ffPull.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module). Default runner uses `promisify(execFile)` — pattern from `src/server/tmux.ts:1-4`.
- Produces:
  - `type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>`
  - `interface FfPullResult { status: "updated" | "up-to-date"; from: string; to: string }`
  - `class FfPullError extends Error { kind: "diverged" | "failed"; detail: string }`
  - `function ffPull(cwd: string, run?: GitRun): Promise<FfPullResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/server/ffPull.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ffPull, FfPullError, type GitRun } from "@/server/ffPull";

// A fake runner: `pull` decides what `git pull --ff-only` does; rev-parse returns
// `before` then `after`. Records the cwd it was called with.
function fakeRun(opts: {
  before: string;
  after: string;
  pull: () => Promise<void>;
  seenCwd?: string[];
}): GitRun {
  let revCalls = 0;
  return async (args, cwd) => {
    opts.seenCwd?.push(cwd);
    if (args[0] === "rev-parse") {
      revCalls += 1;
      return { stdout: `${revCalls === 1 ? opts.before : opts.after}\n`, stderr: "" };
    }
    if (args[0] === "pull") {
      await opts.pull();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const ok = () => Promise.resolve();
function gitFail(stderr: string) {
  return () => Promise.reject(Object.assign(new Error("git failed"), { stderr }));
}

describe("ffPull", () => {
  it("reports updated when HEAD moves", async () => {
    const res = await ffPull("/wt", fakeRun({ before: "aaaaaaa", after: "bbbbbbb", pull: ok }));
    expect(res).toEqual({ status: "updated", from: "aaaaaaa", to: "bbbbbbb" });
  });

  it("reports up-to-date when HEAD is unchanged", async () => {
    const res = await ffPull("/wt", fakeRun({ before: "aaaaaaa", after: "aaaaaaa", pull: ok }));
    expect(res).toEqual({ status: "up-to-date", from: "aaaaaaa", to: "aaaaaaa" });
  });

  it("passes the cwd through to git", async () => {
    const seenCwd: string[] = [];
    await ffPull("/some/checkout", fakeRun({ before: "a", after: "b", pull: ok, seenCwd }));
    expect(seenCwd.every((c) => c === "/some/checkout")).toBe(true);
    expect(seenCwd.length).toBeGreaterThan(0);
  });

  it("maps the 'Not possible to fast-forward' failure to diverged", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("hint: ...\nfatal: Not possible to fast-forward, aborting.") });
    await expect(ffPull("/wt", run)).rejects.toMatchObject({ kind: "diverged" });
  });

  it("maps the 'Need to specify how to reconcile' failure to diverged", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("fatal: Need to specify how to reconcile divergent branches.") });
    await expect(ffPull("/wt", run)).rejects.toMatchObject({ kind: "diverged" });
  });

  it("maps any other git failure to failed and keeps a stderr snippet", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("fatal: not a git repository") });
    const err = await ffPull("/wt", run).catch((e) => e);
    expect(err).toBeInstanceOf(FfPullError);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("not a git repository");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/ffPull.test.ts`
Expected: FAIL — cannot resolve `@/server/ffPull` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/server/ffPull.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

export interface FfPullResult {
  status: "updated" | "up-to-date";
  from: string;
  to: string;
}

export class FfPullError extends Error {
  constructor(public readonly kind: "diverged" | "failed", public readonly detail: string) {
    super(`ff-pull ${kind}: ${detail}`);
    this.name = "FfPullError";
  }
}

// LC_ALL=C pins git's output to English so the diverged markers below match a
// localized environment too (mirrors reviewScale.ts). 60s covers a slow fetch.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 60_000, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });

// Markers git prints when --ff-only cannot advance because history diverged.
const DIVERGED_MARKERS = ["Not possible to fast-forward", "Need to specify how to reconcile"];

function stderrOf(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string") {
    return (e as { stderr: string }).stderr;
  }
  return e instanceof Error ? e.message : String(e);
}

// Fast-forward-pull `cwd`. Stateless: single-flight is the caller's responsibility,
// because self-update (one checkout) and per-project pull (many checkouts) scope it
// differently.
export async function ffPull(cwd: string, run: GitRun = defaultRun): Promise<FfPullResult> {
  const from = (await run(["rev-parse", "--short", "HEAD"], cwd)).stdout.trim();
  try {
    await run(["pull", "--ff-only"], cwd);
  } catch (e) {
    const stderr = stderrOf(e);
    const kind = DIVERGED_MARKERS.some((m) => stderr.includes(m)) ? "diverged" : "failed";
    throw new FfPullError(kind, stderr.trim().slice(0, 500));
  }
  const to = (await run(["rev-parse", "--short", "HEAD"], cwd)).stdout.trim();
  return { status: from === to ? "up-to-date" : "updated", from, to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/ffPull.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ffPull.ts tests/server/ffPull.test.ts
git commit -m "feat(server): add stateless ffPull(cwd) fast-forward core (RIC-164)"
```

---

### Task 2: `selfUpdate` wrapper — env gate + single-flight

**Files:**
- Create: `src/server/selfUpdate.ts`
- Test: `tests/server/selfUpdate.test.ts`

**Interfaces:**
- Consumes: `ffPull`, `FfPullResult` from Task 1.
- Produces:
  - `type SelfUpdateResult = FfPullResult`
  - `function isSelfUpdateEnabled(): boolean` — `process.env.MOJITO_SELF_UPDATE === "1"`
  - `function runSelfUpdate(pull?: () => Promise<FfPullResult>): Promise<SelfUpdateResult>` — module-level in-flight dedup; default `pull` is `() => ffPull(process.cwd())`. Errors (`FfPullError`) propagate unchanged.
  - `function _resetSelfUpdate(): void` — test hook that clears the in-flight promise (idiom from `scaleSettings._resetScaleSettingsCache`).

- [ ] **Step 1: Write the failing test**

Create `tests/server/selfUpdate.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { isSelfUpdateEnabled, runSelfUpdate, _resetSelfUpdate } from "@/server/selfUpdate";
import type { FfPullResult } from "@/server/ffPull";

afterEach(() => {
  delete process.env.MOJITO_SELF_UPDATE;
  _resetSelfUpdate();
});

// A controllable pull: resolves only when we call `release`, and counts invocations.
function deferredPull() {
  let calls = 0;
  let release!: (r: FfPullResult) => void;
  const gate = new Promise<FfPullResult>((res) => { release = res; });
  const pull = () => { calls += 1; return gate; };
  return { pull, release, calls: () => calls };
}

describe("isSelfUpdateEnabled", () => {
  it("is true only when the flag equals '1'", () => {
    process.env.MOJITO_SELF_UPDATE = "1";
    expect(isSelfUpdateEnabled()).toBe(true);
    process.env.MOJITO_SELF_UPDATE = "0";
    expect(isSelfUpdateEnabled()).toBe(false);
    delete process.env.MOJITO_SELF_UPDATE;
    expect(isSelfUpdateEnabled()).toBe(false);
  });
});

describe("runSelfUpdate single-flight", () => {
  it("shares one in-flight pull between concurrent callers", async () => {
    const d = deferredPull();
    const a = runSelfUpdate(d.pull);
    const b = runSelfUpdate(d.pull);
    expect(d.calls()).toBe(1); // second caller did not start a new pull
    d.release({ status: "updated", from: "aaa", to: "bbb" });
    expect(await a).toEqual({ status: "updated", from: "aaa", to: "bbb" });
    expect(await b).toEqual({ status: "updated", from: "aaa", to: "bbb" });
  });

  it("allows a fresh pull once the previous one settles", async () => {
    const d1 = deferredPull();
    const p1 = runSelfUpdate(d1.pull);
    d1.release({ status: "up-to-date", from: "aaa", to: "aaa" });
    await p1;
    const d2 = deferredPull();
    runSelfUpdate(d2.pull);
    expect(d2.calls()).toBe(1);
    d2.release({ status: "up-to-date", from: "aaa", to: "aaa" });
  });

  it("clears the in-flight slot when the pull rejects", async () => {
    const failing = () => Promise.reject(new Error("boom"));
    await expect(runSelfUpdate(failing)).rejects.toThrow("boom");
    // A subsequent call must be able to start again (slot cleared in finally).
    const d = deferredPull();
    runSelfUpdate(d.pull);
    expect(d.calls()).toBe(1);
    d.release({ status: "up-to-date", from: "a", to: "a" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/selfUpdate.test.ts`
Expected: FAIL — cannot resolve `@/server/selfUpdate`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/selfUpdate.ts`:

```ts
import { ffPull, type FfPullResult } from "./ffPull.js";

export type SelfUpdateResult = FfPullResult;

export function isSelfUpdateEnabled(): boolean {
  return process.env.MOJITO_SELF_UPDATE === "1";
}

// Module-level single-flight: a second POST while a pull is running gets the same
// promise, so there is never a parallel pull in the one server checkout.
let inflight: Promise<SelfUpdateResult> | null = null;

export function runSelfUpdate(
  pull: () => Promise<FfPullResult> = () => ffPull(process.cwd()),
): Promise<SelfUpdateResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      return await pull();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetSelfUpdate(): void {
  inflight = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/selfUpdate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/selfUpdate.ts tests/server/selfUpdate.test.ts
git commit -m "feat(server): add selfUpdate gate + single-flight wrapper (RIC-164)"
```

---

### Task 3: `/api/self-update` route

**Files:**
- Create: `src/app/api/self-update/route.ts`
- Test: `tests/server/selfUpdateRoute.test.ts`

**Interfaces:**
- Consumes: `getConfig` (`@/server/app`), `tokenFromHeaders` (`@/server/auth`), `isSelfUpdateEnabled` + `runSelfUpdate` (Task 2), `FfPullError` (Task 1).
- Produces: `GET(req: Request)` → `{ enabled: boolean }` (200); `POST(req: Request)` → 200 `{ status, from, to }` | 404 (flag off) | 409 `{ error: "diverged", detail }` | 500 `{ error: "failed", detail }`. Both 401 without a token.

- [ ] **Step 1: Write the failing test**

Create `tests/server/selfUpdateRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";

// The route's dependency runs `git pull` (real side effects), so mock the wrapper.
// FfPullError stays real so the route's `instanceof` check works.
vi.mock("@/server/selfUpdate", () => ({
  isSelfUpdateEnabled: vi.fn(),
  runSelfUpdate: vi.fn(),
}));

import { GET, POST } from "@/app/api/self-update/route";
import { isSelfUpdateEnabled, runSelfUpdate } from "@/server/selfUpdate";
import { FfPullError } from "@/server/ffPull";

const TOKEN = "test-token";
function req(method: string, auth = true): Request {
  return new Request("http://localhost/api/self-update", {
    method,
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(isSelfUpdateEnabled).mockReset();
  vi.mocked(runSelfUpdate).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/self-update", () => {
  it("401 without a token", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    expect((await GET(req("GET", false))).status).toBe(401);
    expect((await POST(req("POST", false))).status).toBe(401);
  });

  it("GET reports enabled=false when the flag is off", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(false);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("GET reports enabled=true when the flag is on", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    expect(await (await GET(req("GET"))).json()).toEqual({ enabled: true });
  });

  it("POST returns 404 when the flag is off", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(false);
    const res = await POST(req("POST"));
    expect(res.status).toBe(404);
    expect(runSelfUpdate).not.toHaveBeenCalled();
  });

  it("POST returns the pull result on success", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockResolvedValue({ status: "updated", from: "aaa", to: "bbb" });
    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "updated", from: "aaa", to: "bbb" });
  });

  it("POST maps a diverged pull to 409", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockRejectedValue(new FfPullError("diverged", "Not possible to fast-forward"));
    const res = await POST(req("POST"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "diverged", detail: "Not possible to fast-forward" });
  });

  it("POST maps a generic git failure to 500", async () => {
    vi.mocked(isSelfUpdateEnabled).mockReturnValue(true);
    vi.mocked(runSelfUpdate).mockRejectedValue(new FfPullError("failed", "fatal: not a git repository"));
    const res = await POST(req("POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed", detail: "fatal: not a git repository" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/selfUpdateRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/self-update/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/self-update/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { isSelfUpdateEnabled, runSelfUpdate } from "@/server/selfUpdate";
import { FfPullError } from "@/server/ffPull";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({ enabled: isSelfUpdateEnabled() });
}

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  // Flag off: the endpoint does not exist for this instance.
  if (!isSelfUpdateEnabled()) return new NextResponse("not found", { status: 404 });
  try {
    return NextResponse.json(await runSelfUpdate());
  } catch (e) {
    if (e instanceof FfPullError) {
      const status = e.kind === "diverged" ? 409 : 500;
      return NextResponse.json({ error: e.kind, detail: e.detail }, { status });
    }
    return NextResponse.json({ error: "failed", detail: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/selfUpdateRoute.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/self-update/route.ts tests/server/selfUpdateRoute.test.ts
git commit -m "feat(api): add /api/self-update route (gate, pull, error mapping) (RIC-164)"
```

---

### Task 4: `nextPollState` health-poll reducer

The pure "down-then-up" predicate, extracted so the reload trigger is testable without timers.

**Files:**
- Create: `src/lib/deployPoll.ts`
- Test: `tests/lib/deployPoll.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PollState { sawDown: boolean; recovered: boolean }`
  - `const initialPollState: PollState`
  - `function nextPollState(state: PollState, up: boolean): PollState` — `recovered` latches true on the first `up === true` that follows at least one `up === false`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/deployPoll.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialPollState, nextPollState, type PollState } from "@/lib/deployPoll";

// Fold a sequence of health probe outcomes and return the final state.
const fold = (ups: boolean[]): PollState => ups.reduce(nextPollState, initialPollState);

describe("nextPollState", () => {
  it("does not recover while the server has only ever been up", () => {
    expect(fold([true, true, true])).toEqual({ sawDown: false, recovered: false });
  });

  it("records the server going down without recovering yet", () => {
    expect(fold([true, false])).toEqual({ sawDown: true, recovered: false });
  });

  it("recovers on the first success after a failure", () => {
    expect(fold([true, false, true])).toEqual({ sawDown: true, recovered: true });
  });

  it("stays recovered on later probes", () => {
    expect(fold([false, true, false, true])).toEqual({ sawDown: true, recovered: true });
  });

  it("tolerates several failures before recovery", () => {
    expect(fold([true, false, false, false, true])).toEqual({ sawDown: true, recovered: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/deployPoll.test.ts`
Expected: FAIL — cannot resolve `@/lib/deployPoll`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/deployPoll.ts`:

```ts
// Tracks a deploy health poll. The deploy is async, so the server may still answer
// 200 for a few seconds after the pull returns; we must see it go DOWN and then come
// back UP before reloading. `recovered` latches so later flaps don't unset it.
export interface PollState {
  sawDown: boolean;
  recovered: boolean;
}

export const initialPollState: PollState = { sawDown: false, recovered: false };

export function nextPollState(state: PollState, up: boolean): PollState {
  if (state.recovered) return state;
  if (!up) return { sawDown: true, recovered: false };
  return { sawDown: state.sawDown, recovered: state.sawDown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/deployPoll.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deployPoll.ts tests/lib/deployPoll.test.ts
git commit -m "feat(lib): add nextPollState down-then-up reducer for deploy polling (RIC-164)"
```

---

### Task 5: `SettingsSheet` "Server" section

Wire the UI: fetch enabled on open, render the button when enabled, POST on click, show the outcome, poll `/api/health`, reload on recovery with a 5-minute fallback. UI wiring is verified by `tsc` + the full suite + a manual check (no unit test — the testable logic lives in Task 4).

**Files:**
- Modify: `src/components/SettingsSheet.tsx`

**Interfaces:**
- Consumes: `apiFetch` (`@/lib/client`), `GET`/`POST /api/self-update` (Task 3), `initialPollState` + `nextPollState` (Task 4), `/api/health`.
- Produces: nothing consumed by later tasks (terminal task).

- [ ] **Step 1: Add the import**

In `src/components/SettingsSheet.tsx`, add after the existing `@/lib/stageDefaults` import (line 5):

```tsx
import { initialPollState, nextPollState } from "@/lib/deployPoll";
```

- [ ] **Step 2: Add self-update state and the enabled fetch**

Immediately after the existing auto-scale `useEffect` block (ends at line 21, the `}, [token]);` for the review-scale fetch), add:

```tsx
  // Self-update ("Pull & deploy"): only shown when the server exposes it
  // (MOJITO_SELF_UPDATE=1). `phase` drives the button label and banners.
  const [selfUpdateEnabled, setSelfUpdateEnabled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "pulling" | "deploying" | "timeout">("idle");
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullErr, setPullErr] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    apiFetch(token, "/api/self-update")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.enabled === "boolean") setSelfUpdateEnabled(b.enabled); })
      .catch(() => { /* leave the section hidden */ });
  }, [token]);

  const pollHealth = () => {
    let state = initialPollState;
    const startedAt = Date.now();
    const tick = async () => {
      if (Date.now() - startedAt > 5 * 60_000) { setPhase("timeout"); return; }
      let up = false;
      try { up = (await apiFetch(token, "/api/health")).ok; } catch { up = false; }
      state = nextPollState(state, up);
      if (state.recovered) { location.reload(); return; }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
  };

  const onPull = async () => {
    setPullErr(null);
    setPullMsg(null);
    setPhase("pulling");
    let res: Response;
    try {
      res = await apiFetch(token, "/api/self-update", { method: "POST" });
    } catch {
      setPhase("idle");
      setPullErr("Network error — could not reach the server.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 200 && body.status === "up-to-date") {
      setPhase("idle");
      setPullMsg(`Already up to date (${body.from}).`);
      return;
    }
    if (res.status === 200 && body.status === "updated") {
      setPullMsg(`Updated ${body.from} → ${body.to}.`);
      setPhase("deploying");
      pollHealth();
      return;
    }
    setPhase("idle");
    const detail = typeof body.detail === "string" && body.detail ? ` — ${body.detail}` : "";
    setPullErr(body.error === "diverged"
      ? `History diverged — resolve from a terminal${detail}`
      : `Update failed${detail}`);
  };
```

- [ ] **Step 3: Render the "Server" section**

In the JSX, replace the final trailing lines of the sheet — the error paragraph and the two closing `</div>`s (currently lines 98-100):

```tsx
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
```

with:

```tsx
        {error && <p className="err-text">{error}</p>}
        {selfUpdateEnabled && (
          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Server</h3>
            <p className="sheet-title">Pull the latest main into this server&apos;s checkout. The deploy hook then restarts the app.</p>
            <button
              className="btn block"
              disabled={phase === "pulling" || phase === "deploying"}
              onClick={onPull}
            >
              {phase === "pulling" ? "Pulling…" : phase === "deploying" ? "Deploying…" : "Pull & deploy"}
            </button>
            {pullMsg && <p className="sheet-title" style={{ margin: "10px 0 0" }}>{pullMsg}</p>}
            {phase === "deploying" && (
              <p className="sheet-title" style={{ margin: "8px 0 0" }}>Deploying — the server restarts in ~1 min…</p>
            )}
            {phase === "timeout" && <p className="err-text">Deploy still running — reload manually.</p>}
            {pullErr && <p className="err-text">{pullErr}</p>}
          </div>
        )}
      </div>
    </div>
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (baseline 366 + 22 new = 388), 0 failures.

- [ ] **Step 5: Manual verification (record outcome)**

With the dev server running, confirm each — the branch is not "done" until these hold (see `docs/superpowers/plans/smoke-checklist.md` for how the app is launched):

1. **Flag off (default dev):** open Settings → the "Server" section is **absent**. `curl -s -H "x-mojito-token: $TOKEN" localhost:4711/api/self-update` → `{"enabled":false}`; `curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-mojito-token: $TOKEN" localhost:4711/api/self-update` → `404`.
2. **Flag on** (`MOJITO_SELF_UPDATE=1` in `.env.local`, restart): the section appears with a **Pull & deploy** button; `GET` → `{"enabled":true}`.
3. **Up-to-date:** click when the checkout is current → inline "Already up to date (`<sha>`)", no banner.
4. **401:** `curl` without the token header → `401` on both `GET` and `POST`.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsSheet.tsx
git commit -m "feat(ui): add self-update Server section to SettingsSheet (RIC-164)"
```

---

## Self-Review

**1. Spec coverage:**
- Gated by `MOJITO_SELF_UPDATE=1`; button absent + `GET {enabled:false}` + `POST 404` when off → Tasks 2, 3, 5 (Step 5.1).
- `git pull --ff-only` via execFile (no shell), HEAD before/after, in-flight dedup → Tasks 1 (core) + 2 (dedup).
- `POST` 200 `{status, from, to}` / 409 diverged / 500 failed, token auth → Task 3.
- Deploy owned by existing post-merge hook; no second pathway → Global Constraints (no deploy code added anywhere). ✓
- `SettingsSheet` Server section, inline outcome, deploying banner, down-then-up `/api/health` poll with auto-reload + 5-min fallback → Tasks 4 + 5.
- Tests: `selfUpdate` unit (mocked runner), route auth/gating, pure poll helper → Tasks 1–4. ✓
- Addendum: `ffPull(cwd)` own module, `selfUpdate` calls it, single-flight per-caller → Tasks 1 + 2. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**3. Type consistency:** `FfPullResult {status, from, to}` (Task 1) is reused as `SelfUpdateResult` (Task 2), returned verbatim by the route (Task 3), and read as `body.status/from/to` in the UI (Task 5). `FfPullError {kind, detail}` (Task 1) is thrown by `ffPull`, propagated by `runSelfUpdate`, and mapped by `kind` in the route. `nextPollState`/`initialPollState`/`PollState` (Task 4) are consumed unchanged in Task 5. ✓
