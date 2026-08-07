"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";
import { readAsDataUrl } from "@/lib/readAsDataUrl";

const GENERAL = "__general__";

interface PendingImage { id: string; name: string; type: string; dataUrl: string; }

// `crypto.randomUUID` is only defined in secure contexts (HTTPS / localhost). The app is
// served over plain HTTP, so over a LAN IP (mobile access) it is undefined and throws.
// The id is only a React key / removal handle, so a non-crypto fallback is fine.
function newImageId(): string {
  return crypto.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function NewTicketSheet(
  { token, onClose, onCreated }:
  { token: string; onClose: () => void; onCreated: () => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch(token, "/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects: string[] }) => setProjects(d.projects))
      .catch(() => setProjects([]));
  }, [token]);

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
    try {
      const res = await apiFetch(token, "/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), brief: brief.trim(),
          projectName: project === GENERAL ? null : project,
          images: images.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
        }),
      });
      if (!res.ok) { setErr(await res.text()); return; }
      onCreated();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <h3>New ticket</h3>
        <label className="field"><span className="lbl">Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value={GENERAL}>General (home)</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label>
        <label className="field"><span className="lbl">Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ticket title" />
        </label>
        <label className="field"><span className="lbl">Description</span>
          <textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} onPaste={onPaste}
            placeholder="Describe the ticket — this becomes the issue description. Paste or drop images." />
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
        <button className="btn primary block" disabled={!title.trim() || isSubmitting} onClick={create}>Create ticket</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
