/** localStorage key of the access token (the v1 app's own key: a phone that had it keeps it). */
export const TOKEN_KEY = "mojito-token";

/**
 * Decide the initial access token on page load.
 *
 * A token carried in the URL query (e.g. the link Mojito prints for phone access)
 * takes precedence and logs the user in automatically; otherwise the previously
 * stored token is reused. An empty result means no token — the gate shows.
 *
 * `fromUrl` tells the caller to persist the token and strip it from the address bar
 * so it isn't left in history.
 */
export function resolveInitialToken(
  search: string,
  stored: string | null,
): { token: string; fromUrl: boolean } {
  const fromUrl = new URLSearchParams(search).get("token");
  if (fromUrl) return { token: fromUrl, fromUrl: true };
  return { token: stored ?? "", fromUrl: false };
}

// The token lives in memory first, storage second: Safari's private mode throws on
// setItem, and a browser that refuses to remember it must not stop the app working.
let current = "";
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function store(op: () => void) {
  try {
    op();
  } catch {
    // storage unavailable: the in-memory token still serves this page load
  }
}

export function getToken(): string {
  return current;
}

export function setToken(token: string): void {
  current = token;
  store(() => localStorage.setItem(TOKEN_KEY, token));
  notify();
}

/** Forgets the token everywhere; the gate reappears for whoever is subscribed. */
export function clearToken(): void {
  current = "";
  store(() => localStorage.removeItem(TOKEN_KEY));
  notify();
}

/** Subscribes to token changes (the shape `useSyncExternalStore` wants). */
export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Adopts whatever is stored into memory and answers it. */
export function loadStoredToken(): string {
  let stored: string | null = null;
  store(() => { stored = localStorage.getItem(TOKEN_KEY); });
  current = stored ?? "";
  return current;
}

/**
 * Page-load glue: resolves the token from the url and storage, persists a url-borne
 * one and strips it from the address bar so it is not left in history.
 */
export function initToken(): void {
  const stored = loadStoredToken();
  const { token, fromUrl } = resolveInitialToken(window.location.search, stored);
  if (fromUrl) {
    setToken(token);
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}
