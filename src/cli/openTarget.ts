/**
 * Which commands to try, in order, to put the session url in front of the human.
 *
 * On macOS the installed PWA is a Safari web app (`~/Applications/<name>.app`, bundle id
 * `com.apple.Safari.WebApp.<uuid>`) and `open -a <name> <url>` deep-links straight into
 * it — provided the url is inside the manifest's scope, which is why the CLI addresses
 * the server as `localhost` rather than `127.0.0.1`. `open -a` exits non-zero when no app
 * of that name is installed, so the plain `open` behind it is the fallback for a machine
 * that never installed the app; the caller runs the list until one attempt exits 0.
 *
 * Off macOS there is only the browser: a Chromium PWA has no name LaunchServices could
 * resolve, and the Linux box has no installed app anyway.
 */
export function openAttempts(
  { platform, url, app, browserOnly }: { platform: string; url: string; app: string; browserOnly: boolean },
): string[][] {
  if (platform !== "darwin") return [["xdg-open", url]];
  if (browserOnly || !app) return [["open", url]];
  return [["open", "-a", app, url], ["open", url]];
}

/** The manifest's own `name`, which is what LaunchServices resolves `open -a` against. */
export const DEFAULT_APP = "Mojito";
