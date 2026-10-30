#!/usr/bin/env bash
# Mojito as a macOS LaunchAgent — the Mac's counterpart of deploy/mojito.service.
#
#   launchd.sh install   write the plist and (re)load it: starts now and at login
#   launchd.sh restart   same as install (the plist is rewritten every time, see below)
#
# `make install-service` and `make deploy` call this on Darwin; nothing else needs to.
#
# A LaunchAgent (the user's gui domain), never a LaunchDaemon: claude reads its credentials
# from the login keychain, which a system daemon cannot reach. Stopping the job leaves the
# sessions alone — tmux daemonizes out of the process group launchd tears down.
#
# launchd hands a job a bare PATH and no locale, so both are baked in from the calling shell:
# node under nvm, tmux under Homebrew and claude under ~/.local/bin are all off the default
# PATH, and a tmux server started without a UTF-8 locale draws claude's TUI as underscores.
# The plist is rewritten on every restart for that reason: `make deploy` has just run
# `pnpm install` with this shell's node, which is the one the native modules (node-pty,
# better-sqlite3) were built against, so an nvm switch is picked up by the next deploy
# instead of crash-looping the service on an ABI mismatch.
#
# caffeinate keeps the Mac awake while the server runs (the phone cannot reach a sleeping
# Mac). It watches the shell's pid instead of wrapping node: `exec` keeps that pid, so
# launchd's SIGTERM lands on node itself.
set -euo pipefail

LABEL=com.mojito.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Mojito"
LOG="$LOG_DIR/mojito.log"
DOMAIN="gui/$(id -u)"
TARGET="$DOMAIN/$LABEL"

# The main checkout, never a worktree: a worktree has no .env.local and can be removed under
# a running service.
repo_root() {
  local common
  common=$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir)
  printf '%s' "${common%/.git}"
}

# The calling PATH minus what a package manager injected: run through pnpm, node_modules/.bin
# and node-gyp-bin come first, and baked in they would pin the service to one checkout.
service_path() {
  local IFS=: out="" dir
  for dir in $PATH; do
    case "$dir" in */node_modules/.bin | */node-gyp-bin | "") continue ;; esac
    case ":$out:" in *":$dir:"*) continue ;; esac
    out="${out:+$out:}$dir"
  done
  printf '%s' "$out"
}

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

write_plist() {
  local root=$1 path
  path=$(service_path)
  for tool in node tmux; do
    PATH="$path" command -v "$tool" >/dev/null || {
      echo "$tool is not on PATH — run this from the shell you use Mojito from" >&2
      exit 1
    }
  done
  PATH="$path" command -v claude >/dev/null || echo "warning: claude is not on PATH — sessions will not start" >&2
  if [ ! -f "$root/apps/server/dist/main.js" ]; then
    echo "$root/apps/server/dist/main.js is missing: run 'pnpm build' first" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>/usr/bin/caffeinate -is -w \$\$ &amp; exec node dist/main.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$root/apps/server")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$path")</string>
    <key>LANG</key>
    <string>$(xml_escape "${LANG:-en_US.UTF-8}")</string>
    <key>SHELL</key>
    <string>$(xml_escape "${SHELL:-/bin/zsh}")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart on a crash, not on a clean stop. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF
  plutil -lint "$PLIST" >/dev/null
}

cmd_install() {
  local root
  root=$(repo_root)
  write_plist "$root"
  if launchctl print "$TARGET" >/dev/null 2>&1; then
    launchctl bootout "$TARGET"
  fi
  # A bootstrap right after a bootout can fail with "Input/output error" while launchd is
  # still tearing the old job down: retry for a few seconds.
  for _ in 1 2 3 4 5; do
    if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
      echo "OK — $LABEL loaded from $PLIST (logs: $LOG)"
      return 0
    fi
    sleep 1
  done
  launchctl bootstrap "$DOMAIN" "$PLIST"
}

case "${1:-}" in
  install | restart) cmd_install ;;
  *)
    echo "usage: $0 install|restart" >&2
    exit 2
    ;;
esac
