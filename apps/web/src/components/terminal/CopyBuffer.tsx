import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bufferText } from "@/lib/terminal/terminalText";
import { cn } from "@/lib/utils";

interface Props {
  term: Terminal;
  onClose(): void;
}

/**
 * The terminal's own text on a surface iOS will let you long-press, select and "Copy"
 * from (see `terminalText.ts` for why the terminal cannot be selected, and why a copy
 * button cannot work over plain http). A `<pre>`, deliberately not a `<textarea>`:
 * focusing one raises the keyboard — the wrong thing when you meant to copy, and enough
 * of a viewport change to send the terminal through a re-fit.
 *
 * A snapshot taken when it opens: the pty keeps writing behind it, and text that reflows
 * under a half-placed selection handle cannot be copied. Close and reopen to re-read.
 */
export function CopyBuffer({ term, onClose }: Props) {
  const [text] = useState(() => bufferText(term.buffer.active));
  const body = useRef<HTMLPreElement>(null);

  // Open at the bottom: the newest output is what a copy is almost always after.
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className="flex items-start gap-1.5 border-t bg-background p-2">
      <pre
        ref={body}
        className={cn(
          "m-0 max-h-[42dvh] min-w-0 flex-1 overflow-y-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-xs leading-[1.45] break-words whitespace-pre-wrap select-text [-webkit-user-select:text]",
          !text && "text-muted-foreground",
        )}
      >
        {text || "— no text on screen —"}
      </pre>
      <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
