/**
 * The "open this directory elsewhere" links in the terminal header: Warp and VS Code,
 * pointed at the session's own cwd — the ticket's worktree when it has one, the repo
 * root otherwise, since that is what Mojito spawned the session in.
 *
 * Plain URI schemes handed to the OS by the browser, not a server-side `open -a`: no
 * new endpoint and no child process, and the machine that has Warp and VS Code on it
 * is the machine the browser runs on. The trade is that these do nothing from the
 * phone — the buttons are still rendered there, because whether the OS has a handler
 * for a scheme is not something the page can ask.
 *
 * Both take an absolute path and nothing else: a relative cwd would resolve against
 * whatever directory the *receiving app* happens to consider current, which is not a
 * wrong window so much as an unpredictable one. An empty string means "no link", which
 * is how the header decides not to render the action at all.
 */

/** `warp://action/new_tab?path=…` — the path rides in a query parameter, so it is encoded whole. */
export function warpUrl(cwd: string): string {
  const dir = absolute(cwd);
  return dir ? `warp://action/new_tab?path=${encodeURIComponent(dir)}` : "";
}

/**
 * `vscode://file/…/` — the path rides in the URI's *path*, so each segment is encoded
 * on its own and the separators survive. The trailing slash is what tells VS Code it
 * is opening a folder rather than a file.
 */
export function vscodeUrl(cwd: string): string {
  const dir = absolute(cwd);
  if (!dir) return "";
  const encoded = dir.split("/").map(encodeURIComponent).join("/");
  return `vscode://file${encoded.endsWith("/") ? encoded : `${encoded}/`}`;
}

/** Normalises to an absolute path with no trailing slash, or "" when it is not absolute. */
function absolute(cwd: string): string {
  const raw = cwd.trim();
  if (!raw.startsWith("/")) return "";
  return raw.replace(/\/+$/, "") || "/";
}
