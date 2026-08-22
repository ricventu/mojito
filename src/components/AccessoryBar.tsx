"use client";
import { useEffect, useRef, useState } from "react";
import { Paperclip, SquarePen, X } from "lucide-react";
import { normalizePaste } from "@/lib/pasteText";
import { composerHeight } from "@/lib/composerHeight";

const KEYS: { label: string; bytes: string }[] = [
  { label: "Esc", bytes: "\x1b" },
  { label: "Tab", bytes: "\t" },
  { label: "↑", bytes: "\x1b[A" },
  { label: "↓", bytes: "\x1b[B" },
  { label: "←", bytes: "\x1b[D" },
  { label: "→", bytes: "\x1b[C" },
  { label: "⏎", bytes: "\r" },
  { label: "⇧⏎", bytes: "\n" },
  { label: "^C", bytes: "\x03" },
  { label: "1", bytes: "1" },
  { label: "2", bytes: "2" },
  { label: "3", bytes: "3" },
];

// Grow the composer to five lines, then let it scroll. See composerHeight.ts for
// why there is a cap at all.
const COMPOSER_MAX_LINES = 5;

export default function AccessoryBar(
  { onSend, onInsertText, onPickImages }:
  { onSend: (bytes: string) => void; onInsertText: (text: string) => void; onPickImages: (files: File[]) => void },
) {
  // The composer: a real <textarea> to write in, whose content is then injected
  // into the terminal through xterm's own paste path.
  //
  // It exists because the terminal is not a text field. xterm takes input
  // through one hidden helper textarea sized to a single cell at `zIndex: -5`,
  // cleared on Enter, Ctrl-C and blur, and never reconciled with what the pty
  // holds — so every iOS text-editing affordance is either missing or broken
  // against it:
  //   - long-press offers no "Incolla", since the terminal itself is a canvas;
  //   - holding the spacebar turns the keyboard into a caret trackpad, but
  //     nothing in xterm turns a caret move into a `\x1b[C`/`\x1b[D`, so the
  //     gesture slides a caret around a scratch buffer and sends nothing;
  //   - dictation arrives twice, because xterm's `_inputEvent` insertText path
  //     and CompositionHelper's `compositionend` path can each deliver the same
  //     phrase (the `cancel(ev)` meant to stop the first cannot: `input` is not
  //     a cancelable event).
  // In a plain textarea all three work natively, and you get to read a dictated
  // prompt back before it reaches claude. Hence a toggle rather than an
  // always-on row: the terminal keeps every row it has until you want this.
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Size the field to its content. Runs on every keystroke and on reveal, since
  // a dictated phrase lands as one change and would otherwise stay clipped to
  // whatever height the field opened at.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Collapse first: `scrollHeight` never reports less than the height already
    // pinned on the element, so without this the field grows and never shrinks.
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const height = composerHeight({
      scrollHeight: el.scrollHeight,
      // Not `px()` — a "normal" line-height must stay NaN so composerHeight can
      // decline the pass rather than measure against a zero.
      lineHeight: parseFloat(style.lineHeight),
      verticalPadding: px(style.paddingTop) + px(style.paddingBottom),
      verticalBorder: px(style.borderTopWidth) + px(style.borderBottomWidth),
      maxLines: COMPOSER_MAX_LINES,
    });
    // "" hands the box back to the CSS min-height.
    el.style.height = height === null ? "" : `${height}px`;
  }, [draft, composerOpen]);

  const inject = () => {
    const text = normalizePaste(draft);
    // Empty / whitespace-only: no-op and keep the field open so the user can retry or
    // cancel. Only a real insert clears the draft and closes the field.
    if (!text) return;
    onInsertText(text);
    setDraft("");
    setComposerOpen(false);
  };

  const cancel = () => {
    setDraft("");
    setComposerOpen(false);
  };

  return (
    <div className="acc-wrap">
      {composerOpen && (
        <div className="composer">
          {/* autoFocus fires on mount (when composerOpen flips true), so the field
              is ready straight away — for the dictation key, a long-press →
              Incolla, or a space-hold caret drag. */}
          <textarea
            autoFocus
            ref={inputRef}
            className="composer-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Dettatura, incolla o scrivi — poi Inietta"
          />
          <button type="button" className="k" onClick={inject}>Inietta</button>
          <button type="button" className="k icon" aria-label="Chiudi" onClick={cancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="acc">
        {/* A stroke icon rather than a glyph: an emoji renders in its own
            colours and at its own weight, out of step with the text keys
            beside it. Sized by prop, not by a Tailwind class — the utilities
            stay inside `src/components/ui` (see CLAUDE.md). */}
        <button
          type="button"
          className="k icon"
          aria-label="Componi"
          title="Componi (dettatura, incolla, sposta il cursore)"
          onClick={() => setComposerOpen((v) => !v)}
        >
          <SquarePen size={16} aria-hidden="true" />
        </button>
        {KEYS.map((k) => (
          <button key={k.label} className="k" onClick={() => onSend(k.bytes)}>{k.label}</button>
        ))}
        <button type="button" className="k icon" aria-label="Attach image" onClick={() => fileInput.current?.click()}>
          <Paperclip size={16} aria-hidden="true" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { onPickImages(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>
    </div>
  );
}
