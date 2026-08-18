"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useDocList, useDocContent, type DocsTarget } from "@/lib/useDocs";
import { relativeTime } from "@/lib/relativeTime";

// The markdown parser is ~70 KB of JS that only matters once a document is
// opened; keep it out of the first paint, as page.tsx does for TerminalView.
const MarkdownDoc = dynamic(() => import("./MarkdownDoc"), { ssr: false });

export default function DocsView(
  { token, target, label, selected, onSelect, onBack }:
  {
    token: string;
    target: DocsTarget;
    label: string;
    // Which document is open lives in the url, so Back walks list → document → out
    // and a link to one document can be shared. Hence controlled from the outside,
    // and hence a single onBack rather than a separate onClose: both of this header's
    // back steps are history steps now, and only the caller knows where each lands.
    selected: string | null;
    onSelect: (path: string) => void;
    onBack: () => void;
  },
) {
  // Two independent counters, not one shared: bumping the list's ↻ must not
  // re-fetch an open document (and vice versa) — the two refreshes are
  // separate user intents even though they share one button glyph.
  const [listReload, setListReload] = useState(0);
  const [docReload, setDocReload] = useState(0);
  const { files, error: listError } = useDocList(token, target, listReload);
  const { content, error: docError } = useDocContent(token, target, selected, docReload);
  const current = files?.find((f) => f.path === selected);

  return (
    <div className="docs-root">
      <header className="docs-head">
        <button className="back" aria-label="Back" onClick={onBack}>‹</button>
        <span className="name">{selected ? (current?.name ?? selected) : `${label} · docs`}</span>
        <span className="grow" />
        <button
          className="btn sm"
          aria-label="Reload"
          onClick={() => (selected ? setDocReload((n) => n + 1) : setListReload((n) => n + 1))}
        >↻</button>
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
          <button key={f.path} className="docs-item" onClick={() => onSelect(f.path)}>
            <div className="name">{f.name}</div>
            <div className="meta">{f.source} · {relativeTime(f.mtime)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
