import { DEFAULT_PROMPTS, FavoritesBody, type PromptKey, type Settings, type SettingsBody, type StatusDefault } from "@mojito/shared";
import type { Db } from "./db";

const STATUSES = ["Backlog", "Todo", "In Progress", "In Review"] as const;

export function defaultSettings(): Settings {
  const statusDefaults: Record<string, StatusDefault> = {};
  for (const s of STATUSES) statusDefaults[s] = { model: "opus", effort: "high" };
  return { statusDefaults, prompts: { ...DEFAULT_PROMPTS }, favorites: [] };
}

const PROMPT_KEYS = Object.keys(DEFAULT_PROMPTS) as PromptKey[];

export class SettingsRepo {
  /** A corrupt favourites row is reported once, not on every read. */
  private warnedFavorites = false;

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
    const prompts = this.read("prompts") as Record<string, unknown> | undefined;
    for (const k of PROMPT_KEYS) {
      const p = prompts?.[k];
      if (typeof p === "string") out.prompts[k] = p;
    }
    const storedFavorites = this.read("favorites");
    if (storedFavorites !== undefined) {
      const favorites = FavoritesBody.safeParse(storedFavorites);
      if (favorites.success) out.favorites = favorites.data;
      else if (!this.warnedFavorites) {
        this.warnedFavorites = true;
        const why = favorites.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        console.warn(`settings: stored favorites are invalid, serving none (${why})`);
      }
    }
    return out;
  }

  /**
   * Whether boot has already tried importing projects.json into this database. Kept beside the
   * settings (same key/value table) but not part of `Settings`: it is the server's own
   * bookkeeping, never shown or sent.
   */
  projectsImported(): boolean {
    return this.read("projectsImported") === true;
  }

  markProjectsImported(): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('projectsImported', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run();
  }

  /** Replaces each part `s` carries and keeps the others. */
  set(s: SettingsBody): void {
    const put = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    if (s.statusDefaults) put.run("statusDefaults", JSON.stringify(s.statusDefaults));
    if (s.prompts) {
      // Only the edits are stored: a prompt equal to its default keeps following the shipped
      // text when a later version changes it.
      const edited = Object.fromEntries(PROMPT_KEYS.flatMap((k) => (s.prompts![k] === DEFAULT_PROMPTS[k] ? [] : [[k, s.prompts![k]]])));
      put.run("prompts", JSON.stringify(edited));
    }
    if (s.favorites) put.run("favorites", JSON.stringify(s.favorites));
  }
}
