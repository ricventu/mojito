"use client";

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

export default function AccessoryBar({ onSend }: { onSend: (bytes: string) => void }) {
  return (
    <div className="acc">
      {KEYS.map((k) => (
        <button key={k.label} className="k" onClick={() => onSend(k.bytes)}>{k.label}</button>
      ))}
    </div>
  );
}
