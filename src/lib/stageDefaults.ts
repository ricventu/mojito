import type { Effort } from "@/server/types";

export interface StageDefault {
  model: string;
  effort: Effort;
}
export type StageDefaults = Record<string, StageDefault>;

export const MODELS = ["opus", "sonnet", "fable"] as const;
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

// The launchable lifecycle statuses (terminal states never launch, so they are not configured).
// Mirrors WORK_STATES in src/server/statusModel.ts — kept in sync by
// tests/lib/stageDefaults.test.ts. Mirrored rather than imported: this module is reachable
// from the browser bundle (LaunchSheet imports it), and the server model must not be.
export const LAUNCHABLE_STATUSES: string[] = ["Backlog", "Todo", "In Progress"];

// Built-in seed defaults. Model cost/capability order is fable > opus > sonnet; fable is the
// premium model (~2x opus) and is never a default — it stays opt-in via the UI.
// One work session covers design through review, so the model stays opus — but effort is
// where a work session's tokens actually go, and xhigh on every launch spent them on the
// routine tickets too. high is the seed; xhigh and max stay one tap away in the launch
// sheet for the ticket that earns them, and in Settings for anyone who wants them back as
// the default. Same value as FALLBACK below, which is what an unlisted status already got.
export const BUILTIN_STAGE_DEFAULTS: StageDefaults = {
  Backlog: { model: "opus", effort: "high" },
  Todo: { model: "opus", effort: "high" },
  "In Progress": { model: "opus", effort: "high" },
};

// App-wide fallback for any status outside the table.
export const FALLBACK: StageDefault = { model: "opus", effort: "high" };

// UI rows: one row for the work states (Backlog/Todo/In Progress all share the same
// design-through-review session profile), writing all three keys.
export const STAGE_DEFAULT_ROWS: { label: string; statuses: string[] }[] = [
  { label: "Work (Backlog/Todo/In Progress)", statuses: ["Backlog", "Todo", "In Progress"] },
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

// Lenient read-side filter: unlike validateStageDefaults (which rejects the whole map on the
// first bad entry), this drops only the invalid entries and keeps the rest. Used when reading a
// hand-edited (or stale) override file, so a single bad value never breaks the other statuses.
export function sanitizeOverrides(x: unknown): StageDefaults {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return {};
  const value: StageDefaults = {};
  for (const [status, v] of Object.entries(x as Record<string, unknown>)) {
    if (!LAUNCHABLE_STATUSES.includes(status)) continue;
    if (v === null || typeof v !== "object") continue;
    const { model, effort } = v as { model?: unknown; effort?: unknown };
    if (typeof model !== "string" || !MODELS.includes(model as (typeof MODELS)[number])) continue;
    if (typeof effort !== "string" || !EFFORTS.includes(effort as Effort)) continue;
    value[status] = { model, effort: effort as Effort };
  }
  return value;
}

// Keep only the entries in `full` that differ from the built-in seed (or have no built-in entry
// at all). Used before persisting a Settings draft, so the stored file stays a partial map and
// future BUILTIN_STAGE_DEFAULTS changes keep reaching users who never touched a given status.
export function minimalOverrides(full: StageDefaults): StageDefaults {
  const out: StageDefaults = {};
  for (const [status, v] of Object.entries(full)) {
    const builtin = BUILTIN_STAGE_DEFAULTS[status];
    if (!builtin || builtin.model !== v.model || builtin.effort !== v.effort) {
      out[status] = v;
    }
  }
  return out;
}
