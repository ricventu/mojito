# Per-state model & effort defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each lifecycle status its own default model + effort, stored in an editable config file, used by auto-advance and pre-filled in the launch UI, with a Settings sheet to change them.

**Architecture:** A pure client+server-safe module (`src/lib/stageDefaults.ts`) holds the built-in seed table and pure resolvers. A server-only module (`src/server/stageDefaults.ts`) layers a JSON override file over the built-ins with an in-process cache. Auto-advance resolves model+effort per target status (fixing the bug where it inherited the prior stage's model). A token-guarded API route reads/writes the override file; a Settings sheet edits it.

**Tech Stack:** Next.js App Router, TypeScript, React (client components), Vitest (node environment).

## Global Constraints

- All code artifacts in English (identifiers, comments, commits).
- Model cost/capability order: `fable` > `opus` > `sonnet`. `fable` is premium (~2x opus) and is **not** a default anywhere; it stays opt-in via the UI.
- Built-in seed defaults (effort matches the pre-existing `EFFORT_OF_STATUS`):
  | Status | model | effort |
  |---|---|---|
  | Backlog | opus | xhigh |
  | Todo | opus | xhigh |
  | To Code | opus | high |
  | To Review | opus | xhigh |
  | To QA | sonnet | low |
  | To Merge | opus | xhigh |
- Fallback for any status outside the table: `opus` / `high`.
- Config file: `${MOJITO_CONFIG_DIR ?? ${XDG_CONFIG_HOME ?? ~/.config}/mojito}/stage-defaults.json`.
- Allowed models: `["opus","sonnet","fable"]`. Allowed efforts: `["low","medium","high","xhigh","max"]`.
- Verify each task with `npx tsc --noEmit && npx vitest run` (the tmux integration test self-skips).
- Do not run builds/dev servers in this checkout — a live dev server on :8700 shares `.next`.

---

### Task 1: Pure stage-defaults module

**Files:**
- Create: `src/lib/stageDefaults.ts`
- Test: `tests/lib/stageDefaults.test.ts`

**Interfaces:**
- Consumes: `Effort` from `@/server/types` (a pure type; already imported client-side elsewhere).
- Produces:
  - `interface StageDefault { model: string; effort: Effort }`
  - `type StageDefaults = Record<string, StageDefault>`
  - `const MODELS: readonly ["opus","sonnet","fable"]`
  - `const EFFORTS: readonly Effort[]` = `["low","medium","high","xhigh","max"]`
  - `const LAUNCHABLE_STATUSES: string[]` = `["Backlog","Todo","To Code","To Review","To QA","To Merge"]`
  - `const BUILTIN_STAGE_DEFAULTS: StageDefaults`
  - `const FALLBACK: StageDefault` = `{ model: "opus", effort: "high" }`
  - `const STAGE_DEFAULT_ROWS: { label: string; statuses: string[] }[]`
  - `resolveModel(status: string, overrides?: StageDefaults): string`
  - `resolveEffort(status: string, overrides?: StageDefaults): Effort`
  - `mergeEffective(overrides?: StageDefaults): StageDefaults`
  - `validateStageDefaults(x: unknown): { ok: true; value: StageDefaults } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/stageDefaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  BUILTIN_STAGE_DEFAULTS, LAUNCHABLE_STATUSES, STAGE_DEFAULT_ROWS,
  resolveModel, resolveEffort, mergeEffective, validateStageDefaults,
} from "@/lib/stageDefaults";

describe("built-in seed defaults", () => {
  it("reserves fable (never a default) and uses sonnet only for the mechanical To QA gate", () => {
    const models = LAUNCHABLE_STATUSES.map((s) => BUILTIN_STAGE_DEFAULTS[s].model);
    expect(models).not.toContain("fable");
    expect(BUILTIN_STAGE_DEFAULTS["To QA"]).toEqual({ model: "sonnet", effort: "low" });
    expect(BUILTIN_STAGE_DEFAULTS["To Review"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["To Code"]).toEqual({ model: "opus", effort: "high" });
    expect(BUILTIN_STAGE_DEFAULTS["Backlog"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["To Merge"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("resolvers", () => {
  it("returns the built-in when there is no override", () => {
    expect(resolveModel("To QA")).toBe("sonnet");
    expect(resolveEffort("To Review")).toBe("xhigh");
  });
  it("prefers an override over the built-in", () => {
    const ov = { "To Review": { model: "fable", effort: "max" as const } };
    expect(resolveModel("To Review", ov)).toBe("fable");
    expect(resolveEffort("To Review", ov)).toBe("max");
  });
  it("falls back to opus/high for an unknown status", () => {
    expect(resolveModel("In Progress")).toBe("opus");
    expect(resolveEffort("In Progress")).toBe("high");
  });
});

describe("mergeEffective", () => {
  it("returns one entry per launchable status, overrides layered on built-ins", () => {
    const eff = mergeEffective({ "To QA": { model: "opus", effort: "medium" } });
    expect(Object.keys(eff).sort()).toEqual([...LAUNCHABLE_STATUSES].sort());
    expect(eff["To QA"]).toEqual({ model: "opus", effort: "medium" });
    expect(eff["To Review"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("STAGE_DEFAULT_ROWS", () => {
  it("groups Backlog and Todo into one row and covers every launchable status once", () => {
    expect(STAGE_DEFAULT_ROWS[0]).toEqual({ label: "Backlog/Todo", statuses: ["Backlog", "Todo"] });
    const flat = STAGE_DEFAULT_ROWS.flatMap((r) => r.statuses).sort();
    expect(flat).toEqual([...LAUNCHABLE_STATUSES].sort());
  });
});

describe("validateStageDefaults", () => {
  it("accepts a valid partial map", () => {
    const r = validateStageDefaults({ "To Code": { model: "sonnet", effort: "high" } });
    expect(r.ok).toBe(true);
  });
  it("rejects an unknown status key", () => {
    expect(validateStageDefaults({ "Nope": { model: "opus", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid model", () => {
    expect(validateStageDefaults({ "To Code": { model: "gpt", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid effort", () => {
    expect(validateStageDefaults({ "To Code": { model: "opus", effort: "ultra" } }).ok).toBe(false);
  });
  it("rejects a non-object", () => {
    expect(validateStageDefaults(null).ok).toBe(false);
    expect(validateStageDefaults([]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/stageDefaults.test.ts`
Expected: FAIL — cannot resolve `@/lib/stageDefaults`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/stageDefaults.ts`:

```ts
import type { Effort } from "@/server/types";

export interface StageDefault {
  model: string;
  effort: Effort;
}
export type StageDefaults = Record<string, StageDefault>;

export const MODELS = ["opus", "sonnet", "fable"] as const;
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

// The launchable lifecycle statuses (terminal states never launch, so they are not configured).
export const LAUNCHABLE_STATUSES: string[] = ["Backlog", "Todo", "To Code", "To Review", "To QA", "To Merge"];

// Built-in seed defaults. Model cost/capability order is fable > opus > sonnet; fable is the
// premium model (~2x opus) and is never a default — it stays opt-in via the UI. Effort matches
// the previously hardcoded per-stage table:
//   Backlog/Todo (design: brainstorm/debug -> plan) — highest stakes, a bad plan poisons
//     everything downstream, so opus/xhigh.
//   To Code (subagent-driven implementation) — subagents do the heavy lifting, the orchestrator
//     coordinates/integrates/tests, so opus/high.
//   To Review (read-only code review) — depth pays, opus covers it, no premium needed, so opus/xhigh.
//   To QA (human-approval gate) — mechanical: summary, dispatch on verdict, set status, so the
//     cheapest model at low effort: sonnet/low.
//   To Merge (rebase + merge) — a content-changing rebase runs a merge-gating inline review with
//     no re-QA behind the clean path, same profile as To Review, so opus/xhigh.
export const BUILTIN_STAGE_DEFAULTS: StageDefaults = {
  Backlog: { model: "opus", effort: "xhigh" },
  Todo: { model: "opus", effort: "xhigh" },
  "To Code": { model: "opus", effort: "high" },
  "To Review": { model: "opus", effort: "xhigh" },
  "To QA": { model: "sonnet", effort: "low" },
  "To Merge": { model: "opus", effort: "xhigh" },
};

// App-wide fallback for any status outside the table.
export const FALLBACK: StageDefault = { model: "opus", effort: "high" };

// UI rows: Backlog and Todo are the same design stage, shown as one row writing both keys.
export const STAGE_DEFAULT_ROWS: { label: string; statuses: string[] }[] = [
  { label: "Backlog/Todo", statuses: ["Backlog", "Todo"] },
  { label: "To Code", statuses: ["To Code"] },
  { label: "To Review", statuses: ["To Review"] },
  { label: "To QA", statuses: ["To QA"] },
  { label: "To Merge", statuses: ["To Merge"] },
];

export function resolveModel(status: string, overrides: StageDefaults = {}): string {
  return overrides[status]?.model ?? BUILTIN_STAGE_DEFAULTS[status]?.model ?? FALLBACK.model;
}

export function resolveEffort(status: string, overrides: StageDefaults = {}): Effort {
  return overrides[status]?.effort ?? BUILTIN_STAGE_DEFAULTS[status]?.effort ?? FALLBACK.effort;
}

export function mergeEffective(overrides: StageDefaults = {}): StageDefaults {
  const out: StageDefaults = {};
  for (const s of LAUNCHABLE_STATUSES) {
    out[s] = { model: resolveModel(s, overrides), effort: resolveEffort(s, overrides) };
  }
  return out;
}

export function validateStageDefaults(
  x: unknown,
): { ok: true; value: StageDefaults } | { ok: false; error: string } {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return { ok: false, error: "not an object" };
  const value: StageDefaults = {};
  for (const [status, v] of Object.entries(x as Record<string, unknown>)) {
    if (!LAUNCHABLE_STATUSES.includes(status)) return { ok: false, error: `unknown status: ${status}` };
    if (v === null || typeof v !== "object") return { ok: false, error: `invalid entry: ${status}` };
    const { model, effort } = v as { model?: unknown; effort?: unknown };
    if (typeof model !== "string" || !MODELS.includes(model as (typeof MODELS)[number])) {
      return { ok: false, error: `invalid model for ${status}` };
    }
    if (typeof effort !== "string" || !EFFORTS.includes(effort as Effort)) {
      return { ok: false, error: `invalid effort for ${status}` };
    }
    value[status] = { model, effort: effort as Effort };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/stageDefaults.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stageDefaults.ts tests/lib/stageDefaults.test.ts
git commit -m "feat(mojito): pure per-state model/effort defaults module"
```

---

### Task 2: Server override store (file + cache)

**Files:**
- Create: `src/server/stageDefaults.ts`
- Test: `tests/server/stageDefaults.test.ts`

**Interfaces:**
- Consumes: `mergeEffective`, `resolveModel`, `resolveEffort`, `StageDefaults` from `@/lib/stageDefaults`; `Effort` from `./types.js`.
- Produces:
  - `configPath(env?: NodeJS.ProcessEnv): string`
  - `readOverrides(): StageDefaults`
  - `readEffective(): StageDefaults`
  - `writeOverrides(next: StageDefaults): void`
  - `defaultModelForStatus(status: string): string`
  - `defaultEffortForStatus(status: string): Effort`
  - `_resetStageDefaultsCache(): void` (test hook)

- [ ] **Step 1: Write the failing test**

Create `tests/server/stageDefaults.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath, readOverrides, readEffective, writeOverrides,
  defaultModelForStatus, defaultEffortForStatus, _resetStageDefaultsCache,
} from "@/server/stageDefaults";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  _resetStageDefaultsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("configPath", () => {
  it("uses MOJITO_CONFIG_DIR when set", () => {
    expect(configPath()).toBe(join(dir, "stage-defaults.json"));
  });
  it("falls back to XDG_CONFIG_HOME/mojito", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" } as unknown as NodeJS.ProcessEnv))
      .toBe(join("/x", "mojito", "stage-defaults.json"));
  });
});

describe("no file present", () => {
  it("readOverrides is empty and effective equals the built-ins", () => {
    expect(readOverrides()).toEqual({});
    expect(defaultModelForStatus("To QA")).toBe("sonnet");
    expect(defaultModelForStatus("To Review")).toBe("opus");
    expect(defaultEffortForStatus("To Review")).toBe("xhigh");
    expect(defaultEffortForStatus("In Progress")).toBe("high");
  });
});

describe("override file present", () => {
  it("layers overrides over built-ins", () => {
    writeFileSync(configPath(), JSON.stringify({ "To Review": { model: "fable", effort: "max" } }));
    _resetStageDefaultsCache();
    expect(defaultModelForStatus("To Review")).toBe("fable");
    expect(defaultEffortForStatus("To Review")).toBe("max");
    expect(defaultModelForStatus("To QA")).toBe("sonnet"); // untouched -> built-in
  });
});

describe("corrupt file", () => {
  it("is treated as no overrides and does not throw", () => {
    writeFileSync(configPath(), "{ not json");
    _resetStageDefaultsCache();
    expect(() => readOverrides()).not.toThrow();
    expect(readOverrides()).toEqual({});
    expect(defaultModelForStatus("To QA")).toBe("sonnet");
  });
});

describe("writeOverrides", () => {
  it("persists, creates the dir, and invalidates the cache", () => {
    const nested = join(dir, "deep");
    process.env.MOJITO_CONFIG_DIR = nested;
    _resetStageDefaultsCache();
    writeOverrides({ "To QA": { model: "opus", effort: "medium" } });
    expect(JSON.parse(readFileSync(join(nested, "stage-defaults.json"), "utf8")))
      .toEqual({ "To QA": { model: "opus", effort: "medium" } });
    expect(defaultModelForStatus("To QA")).toBe("opus");
    expect(readEffective()["To QA"]).toEqual({ model: "opus", effort: "medium" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stageDefaults.test.ts`
Expected: FAIL — cannot resolve `@/server/stageDefaults`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/stageDefaults.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { Effort } from "./types.js";
import {
  mergeEffective, resolveModel, resolveEffort, type StageDefaults,
} from "@/lib/stageDefaults";

let cache: StageDefaults | undefined;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.MOJITO_CONFIG_DIR
    ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "mojito");
  return join(dir, "stage-defaults.json");
}

// Read the override layer. Missing or corrupt file -> {} (built-ins only). Cached in-process;
// the single Next.js process makes a module-level cache safe. Invalidated by writeOverrides
// and by _resetStageDefaultsCache (tests).
export function readOverrides(): StageDefaults {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StageDefaults)
      : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function readEffective(): StageDefaults {
  return mergeEffective(readOverrides());
}

export function writeOverrides(next: StageDefaults): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
  cache = next;
}

export function defaultModelForStatus(status: string): string {
  return resolveModel(status, readOverrides());
}

export function defaultEffortForStatus(status: string): Effort {
  return resolveEffort(status, readOverrides());
}

export function _resetStageDefaultsCache(): void {
  cache = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stageDefaults.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/stageDefaults.ts tests/server/stageDefaults.test.ts
git commit -m "feat(mojito): server stage-defaults override store with cache"
```

---

### Task 3: Wire auto-advance to per-status model/effort (the bug fix)

**Files:**
- Modify: `src/server/autoAdvance.ts` (remove `EFFORT_OF_STATUS` + `defaultEffortForStatus`)
- Modify: `src/server/autoAdvanceRunner.ts` (extract `buildAutoAdvanceRequest`, resolve model+effort per status)
- Modify: `src/components/LaunchSheet.tsx` (move the `defaultEffortForStatus` import off `autoAdvance`)
- Modify: `tests/server/autoAdvance.test.ts` (drop the `defaultEffortForStatus` suite/import — it now lives in `stageDefaults`, already covered by Task 2)
- Test: `tests/server/autoAdvanceRunner.test.ts` (new)

**Interfaces:**
- Consumes: `defaultModelForStatus`, `defaultEffortForStatus` from `@/server/stageDefaults`; `SessionMeta` from `./types.js`; `LaunchRequest` from `./launch.js`.
- Produces: `buildAutoAdvanceRequest(prev: SessionMeta, newStatus: string): LaunchRequest` (exported from `autoAdvanceRunner.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/server/autoAdvanceRunner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAutoAdvanceRequest } from "@/server/autoAdvanceRunner";
import { configPath, _resetStageDefaultsCache } from "@/server/stageDefaults";
import type { SessionMeta } from "@/server/types";

const prev: SessionMeta = {
  kind: "lime", id: "mojito-RIC-1-to-code", ticket: "RIC-1", launchStatus: "To Code",
  model: "fable", effort: "high", autoAdvance: true, state: "done", cwd: "/x",
  createdAt: "2026-01-01T00:00:00Z", projectName: "Mojito", title: "T", labels: ["bug"],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  _resetStageDefaultsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("buildAutoAdvanceRequest", () => {
  it("uses the target status's default model, NOT the inherited one (the fable bug)", () => {
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req.model).toBe("opus");   // built-in for To Review, not prev.model "fable"
    expect(req.effort).toBe("xhigh");
  });
  it("carries ticket context forward and targets the new status", () => {
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req).toMatchObject({
      ticket: "RIC-1", status: "To Review", autoAdvance: true,
      projectName: "Mojito", title: "T", labels: ["bug"],
    });
  });
  it("honors an override file for the model", () => {
    writeFileSync(configPath(), JSON.stringify({ "To Review": { model: "fable", effort: "max" } }));
    _resetStageDefaultsCache();
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req.model).toBe("fable");
    expect(req.effort).toBe("max");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/autoAdvanceRunner.test.ts`
Expected: FAIL — `buildAutoAdvanceRequest` is not exported.

- [ ] **Step 3: Remove effort table from `autoAdvance.ts`**

In `src/server/autoAdvance.ts`, delete the `EFFORT_OF_STATUS` constant (lines 29-49, the block-comment + `const EFFORT_OF_STATUS`) and the `defaultEffortForStatus` function (lines 51-53). Leave everything else (`STAGE_OF`, `KNOWN_STATUSES`, `stageOf`, `stageAdvanced`, `decideAutoAdvance`, `GATE_STATES`, `TERMINAL_STATES`) untouched. Remove the now-unused `import type { Effort } from "./types.js";` at the top.

- [ ] **Step 4: Extract `buildAutoAdvanceRequest` and rewire the runner**

Rewrite `src/server/autoAdvanceRunner.ts`:

```ts
import type { SessionMeta } from "./types.js";
import type { LaunchRequest } from "./launch.js";
import { defaultModelForStatus, defaultEffortForStatus } from "./stageDefaults.js";
import { getConfig, getRegistry } from "./app.js";
import { launchSession } from "./launch.js";
import { hasSession, newSession, pipePane, closeSession } from "./tmux.js";
import { supersedeSession } from "./supersede.js";

/**
 * Build the launch request for the next stage. Auto-advance is hands-off, so each stage runs
 * with ITS OWN default model and effort (see stageDefaults) rather than inheriting whatever the
 * user manually picked for the launching stage — a strong stage (e.g. To Review) must never be
 * downgraded to, or splurged on, the previous stage's model.
 */
export function buildAutoAdvanceRequest(prev: SessionMeta, newStatus: string): LaunchRequest {
  return {
    ticket: prev.ticket,
    status: newStatus,
    model: defaultModelForStatus(newStatus),
    effort: defaultEffortForStatus(newStatus),
    autoAdvance: prev.autoAdvance,
    projectName: prev.projectName ?? null,
    title: prev.title ?? "",
    labels: prev.labels ?? [],
  };
}

/**
 * Launch the next stage for a ticket at its per-status default model/effort. Best-effort.
 */
export async function runAutoAdvance(prev: SessionMeta, newStatus: string): Promise<void> {
  const cfg = getConfig();
  const registry = getRegistry();
  const res = await launchSession(
    buildAutoAdvanceRequest(prev, newStatus),
    { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  // Once the next stage is running, gracefully retire the predecessor so a ticket keeps one live
  // session instead of one per status it passed through.
  if (res.ok && res.meta.id !== prev.id) {
    await supersedeSession(prev.id, { closeSession, registry });
  }
}
```

- [ ] **Step 5: Fix the LaunchSheet import (keep it compiling; behavior unchanged for now)**

In `src/components/LaunchSheet.tsx`, replace the import
`import { defaultEffortForStatus } from "@/server/autoAdvance";`
with
`import { resolveEffort } from "@/lib/stageDefaults";`
and change the effort initializer on the `useState` line from
`useState<string>(() => defaultEffortForStatus(ticket.statusName))`
to
`useState<string>(() => resolveEffort(ticket.statusName))`.
(This preserves today's built-in prefill; Task 5 upgrades it to the effective/edited defaults + model.)

- [ ] **Step 6: Update the stale effort test**

In `tests/server/autoAdvance.test.ts`, remove `defaultEffortForStatus` from the import on line 2 and delete the entire `describe("defaultEffortForStatus", …)` block (its behavior is now covered by `tests/server/stageDefaults.test.ts`). Leave the `stageAdvanced` and `decideAutoAdvance` suites unchanged.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. The new `autoAdvanceRunner` test passes; no import errors for the removed `defaultEffortForStatus`.

- [ ] **Step 8: Commit**

```bash
git add src/server/autoAdvance.ts src/server/autoAdvanceRunner.ts src/components/LaunchSheet.tsx tests/server/autoAdvance.test.ts tests/server/autoAdvanceRunner.test.ts
git commit -m "fix(mojito): auto-advance uses per-status default model, not the inherited one"
```

---

### Task 4: API route for reading/writing the defaults

**Files:**
- Create: `src/app/api/config/stage-defaults/route.ts`
- Test: `tests/server/stageDefaultsRoute.test.ts`

**Interfaces:**
- Consumes: `getConfig` from `@/server/app`, `tokenFromHeaders` from `@/server/auth`, `readEffective`/`writeOverrides` from `@/server/stageDefaults`, `validateStageDefaults` from `@/lib/stageDefaults`.
- Produces: `GET(req: Request)` and `PUT(req: Request)` route handlers.

Note the auth pattern from `src/app/api/sessions/route.ts`: `if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });`. The test sets `MOJITO_TOKEN`/`LINEAR_API_KEY` so `getConfig()` (memoized in `app.ts`) succeeds; pass the header `x-mojito-token` matching it.

- [ ] **Step 1: Write the failing test**

Create `tests/server/stageDefaultsRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "@/app/api/config/stage-defaults/route";
import { _resetStageDefaultsCache } from "@/server/stageDefaults";

const TOKEN = "test-token";
function req(method: string, body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/config/stage-defaults", {
    method,
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  _resetStageDefaultsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/config/stage-defaults", () => {
  it("401 without a token", async () => {
    expect((await GET(req("GET", undefined, false))).status).toBe(401);
  });
  it("returns the effective table (built-ins when no file)", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["To QA"]).toEqual({ model: "sonnet", effort: "low" });
    expect(body["To Review"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("PUT /api/config/stage-defaults", () => {
  it("401 without a token", async () => {
    expect((await PUT(req("PUT", { "To QA": { model: "opus", effort: "medium" } }, false))).status).toBe(401);
  });
  it("persists a valid override and returns the new effective table", async () => {
    const res = await PUT(req("PUT", { "To QA": { model: "opus", effort: "medium" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["To QA"]).toEqual({ model: "opus", effort: "medium" });
    // A fresh GET reflects it too.
    const after = await (await GET(req("GET"))).json();
    expect(after["To QA"]).toEqual({ model: "opus", effort: "medium" });
  });
  it("422 on an invalid model", async () => {
    const res = await PUT(req("PUT", { "To QA": { model: "gpt", effort: "low" } }));
    expect(res.status).toBe(422);
  });
  it("422 on an unknown status", async () => {
    const res = await PUT(req("PUT", { "Nope": { model: "opus", effort: "low" } }));
    expect(res.status).toBe(422);
  });
  it("400 on bad json", async () => {
    const bad = new Request("http://localhost/api/config/stage-defaults", {
      method: "PUT", headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" }, body: "{ oops",
    });
    expect((await PUT(bad)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stageDefaultsRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/config/stage-defaults/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/config/stage-defaults/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { readEffective, writeOverrides } from "@/server/stageDefaults";
import { validateStageDefaults } from "@/lib/stageDefaults";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(readEffective());
}

export async function PUT(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const parsed = validateStageDefaults(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  writeOverrides(parsed.value);
  return NextResponse.json(readEffective());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/stageDefaultsRoute.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/config/stage-defaults/route.ts tests/server/stageDefaultsRoute.test.ts
git commit -m "feat(mojito): API to read/write per-state model/effort defaults"
```

---

### Task 5: Settings UI + LaunchSheet prefill

**Files:**
- Create: `src/lib/useStageDefaults.ts`
- Create: `src/components/SettingsSheet.tsx`
- Modify: `src/app/page.tsx` (settings state + gear in nav + render sheet)
- Modify: `src/components/LaunchSheet.tsx` (prefill model + effort from effective defaults)
- Modify: `src/app/globals.css` (gear button in `.nav`)

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/client`; `MODELS`, `EFFORTS`, `STAGE_DEFAULT_ROWS`, `resolveModel`, `resolveEffort`, `StageDefaults` from `@/lib/stageDefaults`.
- Produces: `useStageDefaults(token)` → `{ defaults: StageDefaults; loading: boolean; error: string | null; save(next: StageDefaults): Promise<boolean> }`; default-exported `SettingsSheet` component.

This task is UI wiring with no unit-test cycle (the repo has no React/jsdom test setup — vitest runs in `node`). Its gate is `npx tsc --noEmit && npx vitest run` (nothing breaks) plus a manual smoke check by the user in the running app.

- [ ] **Step 1: Create the data hook**

Create `src/lib/useStageDefaults.ts`:

```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { StageDefaults } from "./stageDefaults";

export function useStageDefaults(token: string) {
  const [defaults, setDefaults] = useState<StageDefaults>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/config/stage-defaults");
      if (!res.ok) throw new Error(String(res.status));
      setDefaults(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const save = useCallback(async (next: StageDefaults): Promise<boolean> => {
    const res = await apiFetch(token, "/api/config/stage-defaults", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      let message = `save failed (${res.status})`;
      try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* non-JSON */ }
      setError(message);
      return false;
    }
    setDefaults(await res.json());
    setError(null);
    return true;
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);
  return { defaults, loading, error, save };
}
```

- [ ] **Step 2: Create the Settings sheet**

Create `src/components/SettingsSheet.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useStageDefaults } from "@/lib/useStageDefaults";
import { MODELS, EFFORTS, STAGE_DEFAULT_ROWS, resolveModel, resolveEffort, type StageDefaults } from "@/lib/stageDefaults";

export default function SettingsSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const { defaults, loading, error, save } = useStageDefaults(token);
  // Local draft: one {model, effort} per launchable status, seeded from the fetched effective table.
  const [draft, setDraft] = useState<StageDefaults>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    const next: StageDefaults = {};
    for (const row of STAGE_DEFAULT_ROWS) {
      for (const s of row.statuses) {
        next[s] = { model: resolveModel(s, defaults), effort: resolveEffort(s, defaults) };
      }
    }
    setDraft(next);
  }, [loading, defaults]);

  // A row edits all its statuses together (Backlog/Todo share one control).
  const setRow = (statuses: string[], patch: Partial<{ model: string; effort: string }>) => {
    setDraft((d) => {
      const next = { ...d };
      for (const s of statuses) {
        next[s] = {
          model: patch.model ?? next[s].model,
          effort: (patch.effort as StageDefaults[string]["effort"]) ?? next[s].effort,
        };
      }
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    const ok = await save(draft);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Stage defaults</h3>
        <p className="sheet-title">Default model &amp; effort per lifecycle stage. Used on auto-advance and pre-filled when launching.</p>
        {loading ? <p className="empty">Loading…</p> : STAGE_DEFAULT_ROWS.map((row) => {
          const first = row.statuses[0];
          const cur = draft[first] ?? { model: "opus", effort: "high" };
          return (
            <div className="two" key={row.label} style={{ alignItems: "flex-end" }}>
              <label className="field"><span className="lbl">{row.label}</span>
                <select value={cur.model} onChange={(e) => setRow(row.statuses, { model: e.target.value })}>
                  {MODELS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="field"><span className="lbl">Effort</span>
                <select value={cur.effort} onChange={(e) => setRow(row.statuses, { effort: e.target.value })}>
                  {EFFORTS.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
            </div>
          );
        })}
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving || loading} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <p className="err-text">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the gear into the page**

In `src/app/page.tsx`:
- Add the import: `import SettingsSheet from "@/components/SettingsSheet";`
- Add state near the other `useState` hooks: `const [settingsOpen, setSettingsOpen] = useState(false);`
- Render the sheet just after the `<AlertLayer .../>` line (inside the returned `<div>`):
  `{settingsOpen && <SettingsSheet token={token} onClose={() => setSettingsOpen(false)} />}`
- In the `<nav className="nav">`, add a gear button after the Sessions `<button>`:
  ```tsx
  <button className="tab settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
  ```

- [ ] **Step 4: Style the gear**

In `src/app/globals.css`, just after the `.nav .tab.active` rules (around line 200), add:

```css
.nav .tab.settings { flex: none; padding-left: 18px; padding-right: 18px; font-size: 16px; }
```

- [ ] **Step 5: Upgrade LaunchSheet prefill to the effective defaults**

In `src/components/LaunchSheet.tsx`:
- Add to the imports: `import { useStageDefaults } from "@/lib/useStageDefaults";` and extend the existing `@/lib/stageDefaults` import (from Task 3) to `import { resolveEffort, resolveModel, MODELS, EFFORTS } from "@/lib/stageDefaults";`
- Remove the local `const MODELS = [...]` and `const EFFORTS = [...]` declarations at the top of the file (now imported).
- Replace the two state initializers:
  ```tsx
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState<string>(() => resolveEffort(ticket.statusName));
  ```
  with:
  ```tsx
  const { defaults } = useStageDefaults(token);
  const [model, setModel] = useState<string>(() => resolveModel(ticket.statusName));
  const [effort, setEffort] = useState<string>(() => resolveEffort(ticket.statusName));
  const [touched, setTouched] = useState(false);
  // Re-seed both selectors from the effective (possibly user-edited) defaults once they load,
  // unless the user has already changed a selector this session.
  useEffect(() => {
    if (touched) return;
    setModel(resolveModel(ticket.statusName, defaults));
    setEffort(resolveEffort(ticket.statusName, defaults));
  }, [defaults, ticket.statusName, touched]);
  ```
  Add `useEffect` to the existing `import { useState } from "react";` → `import { useEffect, useState } from "react";`.
- In the `selectors` JSX, mark the selectors touched on change:
  `onChange={(e) => { setModel(e.target.value); setTouched(true); }}` and
  `onChange={(e) => { setEffort(e.target.value); setTouched(true); }}`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. No type errors from the moved `MODELS`/`EFFORTS` or the new imports.

- [ ] **Step 7: Manual smoke check (user, in the running app)**

Ask the user to: open the ⚙ Settings sheet, confirm the 5 rows show the seed defaults (To QA = sonnet/low, others opus), change To QA to opus and Save, reopen to confirm it persisted, then open a To-QA-adjacent ticket's launch sheet and confirm the model selector pre-fills from the saved default. (No automated gate — the repo has no component test harness.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/useStageDefaults.ts src/components/SettingsSheet.tsx src/app/page.tsx src/components/LaunchSheet.tsx src/app/globals.css
git commit -m "feat(mojito): settings sheet + launch prefill for per-state defaults"
```

---

## Self-Review notes

- **Spec coverage:** storage file (Task 2), module split lib/server (Tasks 1-2), auto-advance model fix (Task 3), LaunchSheet model+effort prefill (Task 5), GET/PUT API (Task 4), Settings sheet + gear (Task 5), Backlog/Todo grouped row (Task 1 `STAGE_DEFAULT_ROWS` + Task 5), tests (Tasks 1-4). All covered.
- **CLAUDE.md contract:** `STAGE_OF` stays in `autoAdvance.ts`; `KNOWN_STATUSES` untouched. Only effort defaults move out. No change to the lime↔Mojito launch-context or status-model contracts.
- **Type consistency:** `StageDefaults`/`StageDefault`, `resolveModel`/`resolveEffort`/`mergeEffective`/`validateStageDefaults` (lib), `readEffective`/`writeOverrides`/`readOverrides`/`configPath`/`defaultModelForStatus`/`defaultEffortForStatus`/`_resetStageDefaultsCache` (server), `buildAutoAdvanceRequest` (runner), `useStageDefaults` (hook) — names identical across all tasks that reference them.
