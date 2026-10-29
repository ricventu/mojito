/**
 * `url` when it is an absolute http(s) link, else undefined. A ticket's url comes from Linear,
 * and a task's from the create-ticket agent: neither is ours, and a `javascript:` one in an
 * `href` would run in Mojito's origin, token and all, on a tap.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}
