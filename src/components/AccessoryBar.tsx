"use client";
import { useState } from "react";
import { normalizePaste } from "@/lib/pasteText";

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

export default function AccessoryBar(
  { onSend, onPasteText }:
  { onSend: (bytes: string) => void; onPasteText: (text: string) => void },
) {
  // Mobile paste: the terminal itself is a non-editable xterm canvas, so iOS
  // offers no "Incolla" on long-press. This reveals a real <textarea> the user
  // can paste into natively (works over plain HTTP, unlike navigator.clipboard),
  // review/edit, then inject into the terminal via xterm's own paste path.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const inject = () => {
    const text = normalizePaste(draft);
    if (text) onPasteText(text);
    setDraft("");
    setPasteOpen(false);
  };

  const cancel = () => {
    setDraft("");
    setPasteOpen(false);
  };

  return (
    <div className="acc-wrap">
      {pasteOpen && (
        <div className="paste-field">
          {/* autoFocus fires on mount (when pasteOpen flips true), so the field
              is ready for an immediate long-press → Incolla. */}
          <textarea
            autoFocus
            className="paste-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Long-press → Incolla, poi Inietta"
          />
          <button type="button" className="k" onClick={inject}>Inietta</button>
          <button type="button" className="k" aria-label="Cancel paste" onClick={cancel}>×</button>
        </div>
      )}
      <div className="acc">
        {KEYS.map((k) => (
          <button key={k.label} className="k" onClick={() => onSend(k.bytes)}>{k.label}</button>
        ))}
        <button type="button" className="k" aria-label="Paste" onClick={() => setPasteOpen((v) => !v)}>📋</button>
      </div>
    </div>
  );
}
