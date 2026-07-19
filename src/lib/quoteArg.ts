// Wrap a prompt argument in double quotes only when it contains whitespace, so an
// injected file path with spaces reaches Claude Code as a single token.
export function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}
