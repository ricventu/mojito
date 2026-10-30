import type { RefEntry } from "./graph";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A ticket id as a whole token of a name: bounded by the start/end or one of `/ _ - .`, any case.
 * Branch names here, document paths in the docs viewer.
 */
export function ticketToken(ticket: string): RegExp {
  return new RegExp(`(?:^|[/_.-])${escapeRegExp(ticket)}(?=$|[/_.-])`, "i");
}

/**
 * The branch that carries a ticket: its id as a whole token of the branch name, bounded by the
 * start/end or one of `/ _ - .` (`ricventu/ric-505-git-graph` and `fix/ric-505` match, `ric-5050`
 * and `xric-505` do not), whatever the case. Tags never count. When several match, a local branch
 * wins over an `origin/` one, then one checked out in a worktree, then the most recent committer
 * date, then the name, so the answer is stable.
 */
export function findTicketBranch(entries: RefEntry[], ticket: string): { name: string; hash: string } | null {
  const token = ticketToken(ticket);
  const matches = entries.filter((e) => {
    if (e.ref.kind === "tag") return false;
    const branch = e.ref.kind === "remote" ? e.ref.name.replace(/^origin\//, "") : e.ref.name;
    return token.test(branch);
  });
  matches.sort(
    (a, b) =>
      Number(b.ref.kind === "local") - Number(a.ref.kind === "local") ||
      Number(!!b.ref.worktree) - Number(!!a.ref.worktree) ||
      b.date - a.date ||
      (a.ref.name < b.ref.name ? -1 : a.ref.name > b.ref.name ? 1 : 0),
  );
  const best = matches[0];
  return best ? { name: best.ref.name, hash: best.hash } : null;
}
