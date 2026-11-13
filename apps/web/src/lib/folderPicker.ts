// The project folder picker (RIC-585): paths as the Path field writes them, and the endpoint.

/** A path as the Path field shows it: HOME → "~", under HOME → "~/…", else unchanged. */
export function tildePath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The folder `name` inside `parent` (no double slash at "/"). */
export function childPath(parent: string, name: string): string {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

/** The endpoint for `path`; null or blank = HOME. */
export function dirsHref(path: string | null): string {
  const p = path?.trim();
  return p ? `/api/fs/dirs?path=${encodeURIComponent(p)}` : "/api/fs/dirs";
}
