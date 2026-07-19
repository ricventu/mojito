// Decide whether a pasted textarea value is worth injecting into the terminal.
// Returns the value verbatim (whitespace preserved) when it holds any
// non-whitespace character, else null. The emptiness check trims, but the
// returned value never is — a multi-line snippet must reach the pty unchanged.
export function normalizePaste(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}
