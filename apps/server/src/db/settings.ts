import type { Settings, StatusDefault } from "@mojito/shared";
import type { Db } from "./db";

const STATUSES = ["Backlog", "Todo", "In Progress", "In Review"] as const;

export function defaultSettings(): Settings {
  const statusDefaults: Record<string, StatusDefault> = {};
  for (const s of STATUSES) statusDefaults[s] = { model: "opus", effort: "high" };
  return { statusDefaults, brainstormingDefault: false };
}

export class SettingsRepo {
  constructor(private db: Db) {}

  private read(key: string): unknown {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!r) return undefined;
    try {
      return JSON.parse(r.value);
    } catch {
      return undefined;
    }
  }

  get(): Settings {
    const out = defaultSettings();
    const stored = this.read("statusDefaults");
    if (stored && typeof stored === "object") Object.assign(out.statusDefaults, stored);
    const brainstorming = this.read("brainstormingDefault");
    if (typeof brainstorming === "boolean") out.brainstormingDefault = brainstorming;
    return out;
  }

  set(s: Settings): void {
    const put = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.db.transaction(() => {
      put.run("statusDefaults", JSON.stringify(s.statusDefaults));
      put.run("brainstormingDefault", JSON.stringify(s.brainstormingDefault));
    })();
  }
}
