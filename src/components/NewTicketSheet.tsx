"use client";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";
import { readAsDataUrl } from "@/lib/readAsDataUrl";
import { launchedSession } from "@/lib/launchedSession";
import { sessionUrl } from "@/lib/appLocation";
import { useProjectPicker } from "@/lib/useProjectPicker";
import { projectOptions } from "@/lib/projectOptions";
import { Combobox } from "./ui/combobox";
import type { SessionMeta } from "@/server/types";

interface PendingImage { id: string; name: string; type: string; dataUrl: string; }

// `crypto.randomUUID` is only defined in secure contexts (HTTPS / localhost). The app is
// served over plain HTTP, so over a LAN IP (mobile access) it is undefined and throws.
// The id is only a React key / removal handle, so a non-crypto fallback is fine.
function newImageId(): string {
  return crypto.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function NewTicketSheet(
  { token, defaultProject, onClose, onCreated, onOpen }:
  {
    token: string;
    // Which project the sheet opens on — see newTicketProject. `null` is General (home).
    defaultProject: string | null;
    onClose: () => void;
    onCreated: () => void;
    // The fallback for when the browser refused the new tab; see `create`.
    onOpen: (s: SessionMeta) => void;
  },
) {
  const { projects, project, setProject, projectName } = useProjectPicker(token, defaultProject);
  const [brief, setBrief] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    setErr(null);
    const picked = files.filter((f) => f.type.startsWith("image/"));
    if (!picked.length) return;
    for (const f of picked) {
      if (!ALLOWED_IMAGE_TYPES.includes(f.type)) { setErr(`Unsupported image type: ${f.type}`); return; }
      if (f.size > MAX_IMAGE_BYTES) { setErr(`Image too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)`); return; }
    }
    if (images.length + picked.length > MAX_IMAGES) { setErr(`Too many images (max ${MAX_IMAGES})`); return; }
    let decoded: PendingImage[];
    try {
      decoded = await Promise.all(picked.map(async (f) => ({
        id: newImageId(), name: f.name || "image", type: f.type, dataUrl: await readAsDataUrl(f),
      })));
    } catch {
      setErr("Failed to read one or more images");
      return;
    }
    // Enforce the cap against the true previous state (not the stale `images` closure)
    // so concurrent capture events (e.g. paste + drop) can't both slip past the check above.
    let truncated = false;
    setImages((prev) => {
      const room = Math.max(MAX_IMAGES - prev.length, 0);
      if (decoded.length > room) truncated = true;
      return room > 0 ? [...prev, ...decoded.slice(0, room)] : prev;
    });
    if (truncated) setErr(`Too many images (max ${MAX_IMAGES})`);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) void addFiles(files);
  };

  const removeImage = (id: string) => setImages((prev) => prev.filter((i) => i.id !== id));

  const create = async () => {
    if (isSubmitting) return;
    setErr(null);
    setIsSubmitting(true);
    // Reserved on the click itself, before the first await: a window.open that runs
    // after one is a popup as far as the browser is concerned and gets blocked. `null`
    // means it was blocked anyway (or blocked pre-emptively), which the paths below
    // treat as "no second tab" rather than as a failure.
    const tab = window.open("", "_blank");
    let handedOff = false;
    try {
      const res = await apiFetch(token, "/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          brief: brief.trim(),
          projectName,
          images: images.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
        }),
      });
      if (!res.ok) { setErr(await res.text()); return; }
      onCreated();
      // The issue does not exist yet: the intake session writes it, and it asks for
      // permission before the Linear write, so its terminal has to be on screen rather
      // than behind the list. It goes in a *new browser tab* (RIC-224) — the tab that
      // opened the sheet stays where it was, which is the point of an action reachable
      // from any page: jotting a ticket down must not cost you the session you were
      // watching.
      let payload: unknown = null;
      try { payload = await res.json(); } catch { /* fall through to onClose */ }
      const opened = launchedSession(payload);
      if (!opened) { onClose(); return; }
      // A refused popup is not a reason to lose the permission prompt: fall back to
      // the in-place navigation this sheet did before there was a second tab.
      if (tab) {
        handedOff = true;
        tab.location.replace(sessionUrl(opened.id));
        onClose();
      } else {
        onOpen(opened);
      }
    } finally {
      // Anything that did not hand the reserved tab a url leaves it sitting on
      // about:blank — an error, a body without an id, a throwing fetch.
      if (!handedOff) tab?.close();
      setIsSubmitting(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <h3>New ticket</h3>
        {/* A div, not a label — the field is a button now; see NewSessionSheet. */}
        <div className="field"><span className="lbl">Project</span>
          <Combobox options={projectOptions(projects)} value={project} onChange={setProject}
            label="Project" searchLabel="Search projects…" emptyLabel="No project matches." />
        </div>
        <label className="field"><span className="lbl">Note</span>
          <textarea rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} onPaste={onPaste}
            placeholder="Jot the ticket down — a Claude session cleans it up and titles it. Paste or drop images." />
        </label>
        <div className="img-row">
          <button type="button" className="btn sm" onClick={() => fileInput.current?.click()}>Add image</button>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((img) => (
              <div key={img.id} className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} />
                <button type="button" className="x" aria-label="Remove image" onClick={() => removeImage(img.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        <button className="btn primary block" disabled={!brief.trim() || isSubmitting} onClick={create}>Create ticket</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
