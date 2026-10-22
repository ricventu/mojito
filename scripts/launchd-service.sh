#!/usr/bin/env bash
# Run Mojito as a macOS LaunchAgent instead of a terminal holding `make prod` open.
#
#   launchd-service.sh install    write the plist, (re)load it — starts now and at login
#   launchd-service.sh uninstall  stop it and remove the plist
#   launchd-service.sh restart    stop + start (a full `next build` first, as `make prod`)
#   launchd-service.sh status     launchd's view of the job
#   launchd-service.sh logs       follow the log
#
# A LaunchAgent (the user's gui domain), never a LaunchDaemon: Mojito spawns tmux and
# claude as the logged-in user, and claude reads its credentials from the login keychain,
# which a system daemon cannot reach. Stopping the job leaves the sessions alone — tmux
# daemonizes into its own session, outside the process group launchd tears down.
#
# launchd hands a job a bare PATH (/usr/bin:/bin:/usr/sbin:/sbin) and no locale, so both
# are baked in from the shell that runs `install`: node/pnpm under nvm, tmux under
# Homebrew and claude under ~/.local/bin are all off the default PATH, and a tmux server
# started without a UTF-8 locale draws claude's TUI as underscores. Re-run `install`
# after moving node (an nvm upgrade) or the checkout.
#
# Deploys need nothing from here: "Pull & deploy" signals the supervisor through
# .prod-supervisor.pid exactly as it does under `make prod`.
set -euo pipefail

LABEL="${MOJITO_SERVICE_LABEL:-com.mojito.server}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Mojito"
LOG="$LOG_DIR/mojito.log"
DOMAIN="gui/$(id -u)"
TARGET="$DOMAIN/$LABEL"

# The main checkout, never a worktree: a worktree has no .env.local (RIC-207) and can
# be removed under a running service. Same rule as `make install-cli`.
repo_root() {
  local common
  common=$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir) || {
    echo "not a git checkout" >&2
    exit 1
  }
  printf '%s' "${common%/.git}"
}

loaded() { launchctl print "$TARGET" >/dev/null 2>&1; }

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

# The invoking PATH minus what a package manager injected into it: run through pnpm (or
# from a shell it spawned), node_modules/.bin and pnpm's own node-gyp-bin come first,
# and baked in they would pin the service to one checkout's binaries.
service_path() {
  local IFS=: out="" dir
  for dir in $PATH; do
    case "$dir" in */node_modules/.bin | */node-gyp-bin | "") continue ;; esac
    case ":$out:" in *":$dir:"*) continue ;; esac
    out="${out:+$out:}$dir"
  done
  printf '%s' "$out"
}

# Another supervisor serving this checkout — a `make prod` in a terminal. Two of them
# would race `next build` into the same .next and fight over the port.
foreign_supervisor() {
  local pid
  pid=$(cat "$1/.prod-supervisor.pid" 2>/dev/null) || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && printf '%s' "$pid"
}

write_plist() {
  local root=$1 path lang shell
  path=$(service_path)
  lang="${LANG:-en_US.UTF-8}"
  shell="${SHELL:-/bin/zsh}"
  for tool in node pnpm tmux; do
    PATH="$path" command -v "$tool" >/dev/null || {
      echo "$tool is not on PATH — run this from the shell you use Mojito from" >&2
      exit 1
    }
  done
  PATH="$path" command -v claude >/dev/null || echo "warning: claude is not on PATH — sessions will not start" >&2

  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$root/scripts/launchd-run.sh")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$root")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$path")</string>
    <key>LANG</key>
    <string>$(xml_escape "$lang")</string>
    <key>SHELL</key>
    <string>$(xml_escape "$shell")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart on a crash, not on a clean stop. The supervisor exits 1 when the initial
       build fails, so a broken tree is retried at most once a minute until it builds. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <!-- The supervisor's shutdown waits up to ~7s for the server; leave it room. -->
  <key>ExitTimeOut</key>
  <integer>30</integer>
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
  local root pid
  root=$(repo_root)
  if loaded; then
    echo "==> stopping the running $LABEL"
    launchctl bootout "$TARGET"
  fi
  if pid=$(foreign_supervisor "$root"); then
    echo "A prod supervisor is already serving $root (pid $pid) — stop \`make prod\` (Ctrl-C) first." >&2
    exit 1
  fi
  write_plist "$root"
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "OK — $LABEL loaded from $PLIST"
  echo "   it builds first, then serves; follow it with \`make service-logs\` ($LOG)"
}

cmd_uninstall() {
  if loaded; then launchctl bootout "$TARGET"; fi
  rm -f "$PLIST"
  echo "OK — $LABEL stopped and removed"
}

cmd_restart() {
  loaded || {
    echo "$LABEL is not loaded — run \`make service-install\`" >&2
    exit 1
  }
  launchctl kickstart -k "$TARGET"
  echo "OK — $LABEL restarting (full build first); \`make service-logs\` to follow"
}

cmd_status() {
  if loaded; then
    launchctl print "$TARGET" | grep -E '^\s*(state|pid|last exit code|runs) ='
  else
    echo "$LABEL is not loaded"
  fi
}

cmd_logs() { exec tail -n 100 -F "$LOG"; }

case "${1:-}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *)
    echo "usage: $0 install|uninstall|restart|status|logs" >&2
    exit 2
    ;;
esac
