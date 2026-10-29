/**
 * A project path may start with `~` (`~` alone or `~/…`), the server's home. It is stored as
 * typed — shorter to read on the phone — and expanded only where it meets the disk. `~user`
 * is left alone: it is not the server's home, and the path checks refuse it as relative.
 */
export function expandHome(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? home + path.slice(1) : path;
}
