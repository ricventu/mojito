# Cut-over: v2 replaces v1 (RIC-511)

The last step of the rewrite (core spec, "Cut-over"). v2 takes v1's service name, port and
URL; v1's code leaves the tree; `v2` becomes `main`; one checkout is left.

Decided with the owner on 2026-10-30:

- Cut over now. RIC-507 (`mojito` CLI) and RIC-508 (PWA, self-update) are not ported: v1's
  CLI and "Pull & deploy" are gone until they land; a deploy is `make deploy` from a shell.
- Every "2" goes: env vars, service, make targets, pnpm scripts, localStorage keys, state dir.
- The `Mojito v2` project row is deleted (its checkout disappears); RIC-507/508 move to the
  `Mojito` Linear project.

## Repo

Three commits on `v2`, each green on `pnpm test`, `pnpm typecheck`, `pnpm build` (the first
two under their old `v2:` names where the rename has not happened yet).

**A — remove v1.** Delete `src/`, `server.ts`, `tests/`, `bin/` (v1's CLI), `public/` (v1's
PWA assets), `scripts/` (all v1: supervisors, launchd, icons, worktree init,
`fix-pty-perms.sh` — that one fixes macOS prebuilds only, node-pty builds from source on
Linux), and the root `next.config.mjs`, `next-env.d.ts`, `postcss.config.mjs`,
`tailwind.config.ts`, `tsconfig.json`, `vitest.config.ts`. The root `package.json` becomes a
bare workspace root (no dependencies; scripts only), the lockfile is regenerated.
`pnpm-workspace.yaml` keeps `allowBuilds` (node-pty, better-sqlite3, esbuild), drops
`enablePrePostScripts` (it served `predev`/`prestart`) and its comment stops describing a
Next.js root. The Makefile keeps only the v2 targets. `vite.config.ts` drops
`css.postcss: {}`, which only shielded it from v1's PostCSS config. `.gitignore` loses
Next's entries.

**B — drop the "2".**

| | before | after |
|---|---|---|
| port / host env | `MOJITO2_PORT` (3100) / `MOJITO2_HOST` | `MOJITO_PORT` (8700) / `MOJITO_HOST` |
| state dir | `~/.local/state/mojito2` | `~/.local/state/mojito` |
| unit | `deploy/mojito2.service`, `~/code/mojito-v2` | `deploy/mojito.service`, `~/code/mojito` |
| make | `v2-install-service`, `v2-deploy` | `install-service`, `deploy` |
| pnpm | `v2:dev|build|start|test|typecheck` | `dev|build|start|test|typecheck` |
| localStorage | `mojito2-*` | `mojito-*` |

`childEnv.ts` scrubs `MOJITO_*` (the prefix already covers port and host). The unit sets no
port: `.env.local` carries `MOJITO_PORT=8700`/`MOJITO_HOST=127.0.0.1`. The server's `dev`
script pins `MOJITO_PORT=3100` (the caller's environment wins over `.env.local`), which is
where Vite proxies, and `MOJITO_STATE_DIR=~/.local/state/mojito-dev`, so `pnpm dev` on the
box never collides with the service on 8700 nor opens its database.

**C — docs.** `CLAUDE.md` loses the v1/v2 preamble and table; `README.md` is rewritten for
v2 in English; `.env.example` lists what v2 reads; the core spec's Cut-over section points
here.

## Box

In order:

1. **Git.** Tag `v1` at the current `main` (`e09ae50`), push it — the rollback point. Push
   `v2`. In `~/code/mojito`: `git merge --ff-only v2` (main is an ancestor of v2: no merge
   commit, no force), `git push origin main`, `git push origin --delete v2`.
2. **Build** in `~/code/mojito`: delete `.next/`, `pnpm install --frozen-lockfile`,
   `pnpm build`. `.env.local` is untouched.
3. **Switch.** Stop `mojito` and `mojito2`; `mv ~/.local/state/mojito2 ~/.local/state/mojito`
   (v1's state is `~/.mojito-state`, left in place);
   `make install-service` (overwrites the `mojito.service` unit, enables and starts it);
   disable `mojito2`, delete its unit, `daemon-reload`; `/api/health` on 8700 answers.
   tmux sessions live in scopes of their own and survive.
4. **Tailscale.** `tailscale serve --https=8443 off`. `/` already proxies to 8700.
5. **Data.** Delete the `Mojito v2` project through the API. On Linear: RIC-507/508 to the
   `Mojito` project, RIC-511 to In Review.
6. **Last.** `git worktree remove ~/code/mojito-v2`, `git branch -d v2`.

Known effects: a session's hooks carry the origin it was launched with
(`http://127.0.0.1:3100`), so a v2 session alive across the switch keeps running but its
state stops updating — the only one alive is RIC-511's own, to be killed afterwards. At `/`
the phone keeps v1's stored token: `mojito-token` is the key v1 used.

**Rollback.** Stop `mojito`; `mv ~/.local/state/mojito ~/.local/state/mojito2`; restore v1's unit
(`WorkingDirectory=%h/code/mojito`, `EnvironmentFile=%h/code/mojito/.env.local`,
`ExecStart=/usr/bin/env pnpm start`) and `git checkout v1` + `pnpm install` + `pnpm build`
in a checkout of the tag.
