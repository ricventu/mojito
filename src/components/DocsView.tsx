"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useDocList, useDocContent, type DocsTarget } from "@/lib/useDocs";
import { relativeTime } from "@/lib/relativeTime";

// The markdown parser is ~70 KB of JS that only matters once a document is
// opened; keep it out of the first paint, as page.tsx does for TerminalView.
const MarkdownDoc = dynamic(() => import("./MarkdownDoc"), { ssr: false });

export default function DocsView(
  { token, target, label, onClose }:
  { token: string; target: DocsTarget; label: string; onClose: () => void },
) {
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { files, error: listError } = useDocList(token, target);
  const { content, error: docError } = useDocContent(token, target, selected, reload);
  const current = files?.find((f) => f.path === selected);

  return (
    <div className="docs-root">
      <header className="docs-head">
        <button className="back" aria-label="Back" onClick={() => (selected ? setSelected(null) : onClose())}>‹</button>
        <span className="name">{selected ? (current?.name ?? selected) : `${label} · docs`}</span>
        <span className="grow" />
        {selected && (
          <button className="btn sm" aria-label="Reload" onClick={() => setReload((n) => n + 1)}>↻</button>
        )}
      </header>
      <div className="docs-scroll">
        {selected ? (
          docError ? <p className="empty">{docError}</p>
          : content === null ? <p className="empty">Loading…</p>
          : <MarkdownDoc content={content} />
        ) : listError ? <p className="empty">{listError}</p>
        : files === null ? <p className="empty">Loading…</p>
        : files.length === 0 ? <p className="empty">No documents yet.</p>
        : files.map((f) => (
          <button key={f.path} className="docs-item" onClick={() => setSelected(f.path)}>
            <div className="name">{f.name}</div>
            <div className="meta">{f.source} · {relativeTime(f.mtime)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
