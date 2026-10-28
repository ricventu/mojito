// WebSocket application close code (4000–4999 is reserved for applications): the tmux
// session behind a terminal no longer exists — killed, crashed, or ended. Sent by the
// server's pty gateway; the browser terminal must NOT reconnect on it, or it would retry
// a dead session every 1.5s forever.
export const SESSION_GONE_CODE = 4404;
