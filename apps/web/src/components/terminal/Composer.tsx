import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { composerHeight } from "@/lib/terminal/composerHeight";

/** Grow to five lines, then scroll: the field grows into the terminal's box. */
const MAX_LINES = 5;

interface Props {
  term: Terminal;
  onClose(): void;
}

/**
 * A real `<textarea>` to write in, injected into the terminal through xterm's own paste
 * path. The terminal is not a text field — xterm's hidden helper textarea is one cell
 * wide, cleared on Enter/Ctrl-C/blur, and never reconciled with what the pty holds — so
 * iOS's "Paste" is missing, the space-hold caret trackpad slides a caret around a
 * scratch buffer and sends nothing, and dictation arrives twice. In a plain textarea all
 * three work natively, and a dictated prompt can be read back before it reaches claude.
 * Not a paste box: do not simplify it into one.
 *
 * Inserting sends no CR: a dictation mangles names and code tokens, so the review step
 * is claude's own input line, one `⏎` away in the bar.
 */
export function Composer({ term, onClose }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  // Size the field to its content. Runs on every change, since a dictated phrase lands
  // as one change and would otherwise stay clipped to the height the field opened at.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // Collapse first: `scrollHeight` never reports less than the height already pinned.
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const height = composerHeight({
      scrollHeight: el.scrollHeight,
      // Not `px()`: a "normal" line-height must stay NaN so composerHeight declines.
      lineHeight: parseFloat(style.lineHeight),
      verticalPadding: px(style.paddingTop) + px(style.paddingBottom),
      verticalBorder: px(style.borderTopWidth) + px(style.borderBottomWidth),
      maxLines: MAX_LINES,
    });
    // "" hands the box back to the CSS min-height.
    el.style.height = height === null ? "" : `${height}px`;
  }, [draft]);

  const insert = () => {
    // Whitespace-only is a no-op that keeps the field open; a real insert is verbatim.
    if (draft.trim().length === 0) return;
    term.paste(draft);
    setDraft("");
    onClose();
  };

  return (
    <div className="flex items-end gap-1.5 border-t bg-background p-2">
      {/* autoFocus: ready for the dictation key, a long-press → Paste, or a caret drag.
          `field-sizing-fixed` and the explicit `leading-5` after the font: the height is
          pinned from JS, which reads the line-height back (a "normal" one is not a number). */}
      <Textarea
        autoFocus
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Dictate, paste or type, then Insert"
        className="field-sizing-fixed min-h-10 min-w-0 flex-1 resize-none overflow-y-auto leading-5"
      />
      <Button type="button" onClick={insert}>
        Insert
      </Button>
      <Button type="button" variant="outline" size="icon" aria-label="Close" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
