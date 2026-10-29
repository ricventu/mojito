import type { Terminal } from "@xterm/xterm";
import { Copy, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The key row: names of keys, not icons — no lucide glyph spells "Esc" — so these stay
 * text. The sequences are what xterm would send for the same key; `⇧⏎` is LF, which
 * claude's TUI reads as "newline" where a bare CR submits.
 */
const KEYS: { label: string; bytes: string }[] = [
  { label: "↑", bytes: "\x1b[A" },
  { label: "↓", bytes: "\x1b[B" },
  { label: "←", bytes: "\x1b[D" },
  { label: "→", bytes: "\x1b[C" },
  { label: "⏎", bytes: "\r" },
  { label: "⇧⏎", bytes: "\n" },
  { label: "Esc", bytes: "\x1b" },
  { label: "Tab", bytes: "\t" },
  { label: "⇧Tab", bytes: "\x1b[Z" },
  { label: "^C", bytes: "\x03" },
];

interface Props {
  term: Terminal | null;
  /** Open the composer. */
  onCompose(): void;
  /** Open the buffer copy overlay. */
  onCopy(): void;
  /** Is the mobile keyboard up? Then the bar's bottom edge is the keyboard's, not the home indicator's. */
  keyboardOpen: boolean;
}

/**
 * The touch key row under the terminal: composer first (the one slot that never needs a
 * swipe — the row scrolls and a phone shows about ten keys), the keys, then copy. Shown
 * only on a coarse pointer; a desktop has a keyboard.
 *
 * Keys go through `term.input`, which fires `onData` exactly as a typed key does, so they
 * reach the pty by the same socket path. It pays the bottom safe-area inset itself —
 * except with the keyboard up, where paying it would spend rows on nothing.
 */
export function AccessoryBar({ term, onCompose, onCopy, keyboardOpen }: Props) {
  return (
    <div
      className={cn(
        "hidden gap-1.5 overflow-x-auto border-t bg-background px-2 pt-2 pointer-coarse:flex",
        keyboardOpen ? "pb-2" : "pb-[calc(0.5rem+var(--sab))]",
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Compose"
        title="Compose (dictation, paste, moving the caret)"
        onClick={onCompose}
      >
        <SquarePen size={16} aria-hidden="true" />
      </Button>
      {KEYS.map((k) => (
        <Button
          key={k.label}
          type="button"
          variant="outline"
          disabled={!term}
          className="shrink-0 font-mono font-semibold"
          onClick={() => term?.input(k.bytes)}
        >
          {k.label}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        aria-label="Copy text"
        title="Copy text (long-press to copy)"
        onClick={onCopy}
      >
        <Copy size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
