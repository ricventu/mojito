#!/usr/bin/env bash
# Restore the executable bit on node-pty's spawn-helper.
#
# node-pty ships prebuilt binaries in `prebuilds/<platform>/`, and the install
# leaves `spawn-helper` mode 644 — under npm and under pnpm alike (measured in
# RIC-240; the migration did not change this). node-pty execs that file to fork
# a pty, so without the +x every session dies at spawn.
#
# It lives in a script rather than in a `package.json` line so that `predev`,
# `prestart` and `scripts/init-worktree.sh` can all reach it without one package
# manager shelling out to another — and so no package manager is invoked at all.
#
# On pnpm `node_modules/node-pty` is a symlink into `node_modules/.pnpm`; the
# glob resolves through it. The chmod stays local to this checkout: pnpm clones
# (APFS) or hard-links (elsewhere) files out of the shared store, and on APFS a
# clone has its own inode, so the mode change does not reach the store. See the
# pnpm section of CLAUDE.md for the case where it would.
#
# Never fails the caller: a checkout with no node-pty (or a platform with no
# prebuilds) is not an error, it just has nothing to fix.
set -u
cd "$(dirname "$0")/.."
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true
