/** localStorage key of the theme preference (the v1 app used its own, so the two can coexist). */
export const THEME_KEY = "mojito2-theme";

export type Theme = "dark" | "light";

/** Dark is the default: it is what `index.html` ships and what an unreadable store falls back to. */
export const DEFAULT_THEME: Theme = "dark";

/** The stored preference. Storage can be missing, blocked or hold anything, so every miss is the default. */
export function readTheme(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Theme {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remember the preference; best effort (Safari's private mode throws on `setItem`). */
export function writeTheme(theme: Theme, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* a browser that refuses to remember the theme must not break switching it */
  }
}

/** Show a theme: the `dark` class on `<html>` is the whole mechanism. */
export function applyTheme(theme: Theme, root: Pick<HTMLElement, "classList"> | undefined = defaultRoot()): void {
  root?.classList.toggle("dark", theme === "dark");
}

/** Called before the first render, so a light preference never flashes dark. */
export function initTheme(): void {
  applyTheme(readTheme());
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function defaultRoot(): HTMLElement | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement;
}
