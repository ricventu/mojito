#!/usr/bin/env bash
# Populate a freshly created worktree so a session can actually work in it.
#
# Mojito runs this itself, once, inside the worktree it just created
# (`createTicketWorktree` in src/server/worktree.ts) — never the session. A
# failure here never blocks the launch: Mojito echoes the reason as the first
# line of the session's terminal and opens it anyway.
#
# This exists because of pnpm. Under npm a per-worktree `node_modules` was a
# ~520 MB, minutes-long copy, so nobody populated worktrees automatically and
# every session started by doing it by hand. pnpm clones the packages out of a
# shared store: measured in RIC-240 at ~10 MB and a few seconds per worktree,
# which is cheap enough to just do.
#
# Not copied in: `.env.local`. It holds LINEAR_API_KEY and MOJITO_TOKEN, and
# keeping those out of spawned sessions is the whole point of RIC-207.
set -u -o pipefail
cd "$(dirname "$0")/.."

# An install under NODE_ENV=production strips devDependencies and exits 0 — silent,
# and it takes tsx, vitest and typescript with it (RIC-207). Measured in RIC-240:
# npm 11 does this, pnpm 11 does not (it wants an explicit `--prod`). Kept anyway.
# Mojito's own spawns are already scrubbed (`spawnEnv`), but this script is also
# something a human runs by hand from whatever shell they happen to have.
unset NODE_ENV

echo "==> pnpm install"
if ! pnpm install; then
  echo "init-worktree: pnpm install failed — the worktree has no dependencies" >&2
  exit 1
fi

echo "==> fixing node-pty spawn-helper permissions"
./scripts/fix-pty-perms.sh

echo "init-worktree: ready"
