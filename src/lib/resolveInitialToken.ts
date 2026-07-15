/**
 * Decide the initial access token on page load.
 *
 * A token carried in the URL query (e.g. the link Mojito prints for phone access)
 * takes precedence and logs the user in automatically; otherwise the previously
 * stored token is reused. An empty result means no token — the login screen shows.
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
