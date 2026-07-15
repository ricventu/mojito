// WebSocket application close code (4000–4999 range is reserved for app use):
// the tmux session backing a terminal no longer exists — it was killed, crashed,
// or retired when the ticket auto-advanced to a new stage. Shared by the pty
// gateway (server, which sends it) and TerminalView (client, which must NOT
// reconnect on it). Kept dependency-free so the client can import it without
// pulling node-pty into the browser bundle.
export const SESSION_GONE_CODE = 4404;
