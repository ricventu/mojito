/**
 * A page keeps running the build it loaded, and a suspended installed app is resumed rather than
 * loaded again, with no reload button on iOS. Each build's entry script has a hashed name, so
 * comparing it with the one the server now serves says whether a deploy happened, with no build
 * id to keep in step. Under Vite both sides name the same script: it never prompts.
 */

/** The `src` of the page's first module script; `null` for a page without one. */
export function entryScript(html: string): string | null {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    if (!/\btype="module"/.test(tag)) continue;
    const src = /\bsrc="([^"]+)"/.exec(tag);
    if (src) return src[1] ?? null;
  }
  return null;
}

/** Whether the server serves another build than `running`. A check that cannot tell answers false. */
export async function hasNewBuild(running: string | null, fetchPage: () => Promise<Response>): Promise<boolean> {
  if (running === null) return false;
  try {
    const res = await fetchPage();
    if (!res.ok) return false;
    const served = entryScript(await res.text());
    return served !== null && served !== running;
  } catch {
    return false;
  }
}
