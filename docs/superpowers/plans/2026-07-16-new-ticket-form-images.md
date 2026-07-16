# New-ticket form: full width + image insert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the New-ticket Description textarea full width, and let users add images (clipboard paste, file picker, drag & drop) that Mojito uploads to Linear and that appear inline in the created ticket's description.

**Architecture:** The form sends images as data URLs in the existing `POST /api/sessions` new-ticket body. The route validates + decodes them, uploads each to Linear via a new `uploadImage` GraphQL helper, and threads the resulting asset URLs through `LIME_NEW_CONTEXT.images`. The spawned `/lime-new` session appends each as `![](url)` at the end of the created description.

**Tech Stack:** Next.js 15 / React (client component), TypeScript, Node server logic under `src/server/`, Vitest, Linear GraphQL API. lime is a separate Claude Code plugin repo.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Image caps: **10 MB per image**, **max 10 images**, types **image/png, image/jpeg, image/gif, image/webp** — enforced on both client and server; server is authoritative.
- Images append at the **end** of the created ticket description.
- Test command (Mojito): `npx tsc --noEmit && npx vitest run`.
- Cross-repo sequencing: the **lime** change (Task 1) lands first, then Mojito.
- Follow existing patterns: Linear helpers use injected `fetchImpl` (see `src/server/linear.ts` + `tests/server/linear.test.ts`); server logic under `src/server/`, tests under `tests/server/`.

---

## Task 1: lime-new — accept `images` and append them to the description (separate repo)

Repo: `/Users/ricventu/code/Lime/lime` (NOT the Mojito worktree). Do this on its own branch.

**Files:**
- Modify: `skills/lime-new/SKILL.md`
- Modify: `.claude-plugin/plugin.json` (version bump)
- Modify: `README.md` (if it documents `LIME_NEW_CONTEXT`)

**Interfaces:**
- Produces (runtime contract): `/lime-new` reads `LIME_NEW_CONTEXT.images: string[]` (Linear asset URLs) and appends each as `![](url)` at the end of the created description.

- [ ] **Step 1: Extend the context-read step.** In `skills/lime-new/SKILL.md` Step 1 item 0, change the described JSON shape from `{ "brief": string, "project": string | null }` to `{ "brief": string, "project": string | null, "images": string[] }`, and add a sentence: "`images` is an optional list of Linear asset URLs (already uploaded by the launcher). If absent, treat it as empty."

- [ ] **Step 2: Append images when creating the ticket.** In `skills/lime-new/SKILL.md` Step 3 (Create the ticket), add: "If `images` is non-empty, append each URL as its own Markdown image (`![](url)`) on separate lines at the **end** of the analyzed description, after the analyzed text. Do not alter or reorder them." Update the Guard summary bullet about minimal fields to note that images from the launch context are included in the description.

- [ ] **Step 3: Bump the plugin version.** In `.claude-plugin/plugin.json`, increment the `version` (e.g. patch bump). Note the new version string.

- [ ] **Step 4: Update the README** if it documents the `LIME_NEW_CONTEXT` fields — add `images`.

- [ ] **Step 5: Commit (in the lime repo).**

```bash
git add skills/lime-new/SKILL.md .claude-plugin/plugin.json README.md
git commit -m "feat(lime-new): embed launcher-provided images in the created ticket description"
```

- [ ] **Step 6: Rebuild the plugin cache — USER ACTION (Claude cannot run `/plugin`).** Ask the user to update the lime plugin in Claude Code via `/plugin` so the new version lands in the cache, then verify:

```bash
ls ~/.claude/plugins/cache/lime/lime/
```
Expected: the new version directory from Step 3 is present. Until this is done, a live new-ticket run still uses the old skill (Mojito tests are unaffected).

---

## Task 2: `uploadImage` Linear helper

**Files:**
- Modify: `src/server/linear.ts`
- Test: `tests/server/linear.test.ts`

**Interfaces:**
- Produces: `uploadImage(apiKey: string, file: { filename: string; contentType: string; size: number; bytes: Uint8Array }, fetchImpl?: typeof fetch): Promise<string>` — returns the Linear `assetUrl`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/server/linear.test.ts` (uses the existing `fakeFetch` / `seqFetch` helpers at the top of that file):

```ts
import { uploadImage } from "@/server/linear"; // add to the existing import line

describe("uploadImage", () => {
  it("uploads bytes to the presigned URL and returns the asset URL", async () => {
    const f = seqFetch([
      { fileUpload: { success: true, uploadFile: {
        uploadUrl: "https://up.example/put",
        assetUrl: "https://uploads.linear.app/abc.png",
        headers: [{ key: "x-amz-acl", value: "public-read" }],
      } } },
      {}, // the PUT response body (unused)
    ]);
    const url = await uploadImage(
      "k",
      { filename: "a.png", contentType: "image/png", size: 3, bytes: new Uint8Array([1, 2, 3]) },
      f,
    );
    expect(url).toBe("https://uploads.linear.app/abc.png");
    const putCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(putCall[0]).toBe("https://up.example/put");
    expect(putCall[1].method).toBe("PUT");
    expect(putCall[1].headers["x-amz-acl"]).toBe("public-read");
    expect(putCall[1].headers["Content-Type"]).toBe("image/png");
  });

  it("throws when fileUpload is unsuccessful", async () => {
    const f = fakeFetch({ fileUpload: { success: false } });
    await expect(
      uploadImage("k", { filename: "a.png", contentType: "image/png", size: 1, bytes: new Uint8Array([1]) }, f),
    ).rejects.toThrow(/fileUpload/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: FAIL — `uploadImage` is not exported.

- [ ] **Step 3: Implement `uploadImage`.** Append to `src/server/linear.ts` (reuses the existing private `query()` for the mutation):

```ts
export async function uploadImage(
  apiKey: string,
  file: { filename: string; contentType: string; size: number; bytes: Uint8Array },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const data = await query<{
    fileUpload: {
      success: boolean;
      uploadFile?: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] };
    };
  }>(
    apiKey,
    {
      query: `mutation ($size: Int!, $contentType: String!, $filename: String!) {
        fileUpload(size: $size, contentType: $contentType, filename: $filename) {
          success
          uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      variables: { size: file.size, contentType: file.contentType, filename: file.filename },
    },
    fetchImpl,
  );
  const uf = data.fileUpload.uploadFile;
  if (!data.fileUpload.success || !uf) throw new Error("Linear fileUpload failed");
  const headers: Record<string, string> = { "Content-Type": file.contentType };
  for (const h of uf.headers) headers[h.key] = h.value;
  const put = await fetchImpl(uf.uploadUrl, { method: "PUT", headers, body: file.bytes });
  if (!put.ok) throw new Error(`Linear asset upload failed: ${put.status}`);
  return uf.assetUrl;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add src/server/linear.ts tests/server/linear.test.ts
git commit -m "feat(mojito): uploadImage Linear helper for new-ticket screenshots (RIC-133)"
```

---

## Task 3: Image validation/decode helper + shared constants

**Files:**
- Create: `src/lib/imageConstants.ts` (browser-safe constants shared by client + server)
- Create: `src/server/imageUpload.ts`
- Test: `tests/server/imageUpload.test.ts`

**Interfaces:**
- Produces: `ALLOWED_IMAGE_TYPES: string[]`, `MAX_IMAGE_BYTES: number`, `MAX_IMAGES: number` (from `imageConstants`).
- Produces: `interface DecodedImage { filename: string; contentType: string; size: number; bytes: Buffer }`.
- Produces: `validateImages(input: unknown): { ok: true; files: DecodedImage[] } | { ok: false; error: string }` — `undefined`/`null` → `{ ok: true, files: [] }`.

- [ ] **Step 1: Create the shared constants** in `src/lib/imageConstants.ts` (no Node-only imports — this is imported by the client too):

```ts
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGES = 10;
```

- [ ] **Step 2: Write the failing tests** in `tests/server/imageUpload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateImages } from "@/server/imageUpload";

const png = (b64: string) => `data:image/png;base64,${b64}`;
const tiny = Buffer.from([137, 80, 78, 71]).toString("base64"); // 4 bytes

describe("validateImages", () => {
  it("treats undefined/null as an empty list", () => {
    expect(validateImages(undefined)).toEqual({ ok: true, files: [] });
    expect(validateImages(null)).toEqual({ ok: true, files: [] });
  });

  it("decodes a valid image entry", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: png(tiny) }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toMatchObject({ filename: "a.png", contentType: "image/png", size: 4 });
      expect(res.files[0].bytes).toHaveLength(4);
    }
  });

  it("rejects a non-array", () => {
    expect(validateImages({})).toEqual({ ok: false, error: "images must be an array" });
  });

  it("rejects an unsupported type", () => {
    const res = validateImages([{ name: "a.svg", type: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }]);
    expect(res).toEqual({ ok: false, error: "unsupported image type: image/svg+xml" });
  });

  it("rejects malformed data", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: "not-a-data-url" }]);
    expect(res).toEqual({ ok: false, error: "malformed image data" });
  });

  it("rejects a type/data mismatch", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: `data:image/jpeg;base64,${tiny}` }]);
    expect(res).toEqual({ ok: false, error: "image type mismatch" });
  });

  it("rejects too many images", () => {
    const many = Array.from({ length: 11 }, () => ({ name: "a.png", type: "image/png", dataUrl: png(tiny) }));
    expect(validateImages(many)).toEqual({ ok: false, error: "too many images (max 10)" });
  });

  it("rejects an oversized image", () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    const res = validateImages([{ name: "big.png", type: "image/png", dataUrl: png(big) }]);
    expect(res).toEqual({ ok: false, error: "image too large (max 10485760 bytes)" });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `npx vitest run tests/server/imageUpload.test.ts`
Expected: FAIL — `@/server/imageUpload` does not exist.

- [ ] **Step 4: Implement `src/server/imageUpload.ts`.**

```ts
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";

export interface DecodedImage {
  filename: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { contentType: m[1], bytes: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

export function validateImages(
  input: unknown,
): { ok: true; files: DecodedImage[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, files: [] };
  if (!Array.isArray(input)) return { ok: false, error: "images must be an array" };
  if (input.length > MAX_IMAGES) return { ok: false, error: `too many images (max ${MAX_IMAGES})` };
  const files: DecodedImage[] = [];
  for (const item of input) {
    if (!item || typeof item.dataUrl !== "string" || typeof item.type !== "string") {
      return { ok: false, error: "invalid image entry" };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(item.type)) {
      return { ok: false, error: `unsupported image type: ${item.type}` };
    }
    const parsed = parseDataUrl(item.dataUrl);
    if (!parsed) return { ok: false, error: "malformed image data" };
    if (parsed.contentType !== item.type) return { ok: false, error: "image type mismatch" };
    if (parsed.bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image too large (max ${MAX_IMAGE_BYTES} bytes)` };
    }
    const filename = typeof item.name === "string" && item.name ? item.name : "image";
    files.push({ filename, contentType: item.type, size: parsed.bytes.length, bytes: parsed.bytes });
  }
  return { ok: true, files };
}
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npx vitest run tests/server/imageUpload.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/imageConstants.ts src/server/imageUpload.ts tests/server/imageUpload.test.ts
git commit -m "feat(mojito): validate + decode new-ticket image uploads (RIC-133)"
```

---

## Task 4: Thread `images` through the launch context

**Files:**
- Modify: `src/server/launchContext.ts` (`NewTicketContext`)
- Modify: `src/server/launch.ts` (`NewTicketLaunchRequest` + the `writeNewTicketContext` call)
- Modify: `tests/server/launchContext.test.ts`
- Modify: `tests/server/launch.test.ts`
- Modify: `CLAUDE.md` (contract 1b)

**Interfaces:**
- Consumes: nothing new.
- Produces: `NewTicketContext = { brief: string; project: string | null; images: string[] }`; `NewTicketLaunchRequest` gains optional `images?: string[]`; the written context always includes `images` (defaulting to `[]`).

- [ ] **Step 1: Update the existing tests to expect `images`.**

In `tests/server/launchContext.test.ts`, change `newCtx` and its assertions to include `images`:

```ts
const newCtx: NewTicketContext = { brief: "Aggiungi un pulsante per esportare in CSV", project: "Mojito", images: [] };
```
and in the "accepts a null project" test:
```ts
const p = writeNewTicketContext(dir, "mojito-custom-general-abc123", { brief: "x", project: null, images: [] });
expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "x", project: null, images: [] });
```

In `tests/server/launch.test.ts`, update the "writes the LIME_NEW_CONTEXT file" assertion (currently line ~243):
```ts
expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ brief: "Aggiungi export CSV", project: "Mojito", images: [] });
```

Add one new test in the `launchNewTicketSession` describe block:
```ts
it("writes provided image URLs into the context", async () => {
  const projectsPath = join(dir, "projects.json");
  writeFileSync(projectsPath, JSON.stringify({ RIC: { projects: { Mojito: "/code/Lime/mojito" } } }));
  const d = customDeps({ projectsPath });
  await launchNewTicketSession(
    { brief: "x", projectName: "Mojito", model: "opus", effort: "high", images: ["https://uploads.linear.app/a.png"] },
    d,
  );
  const p = join(dir, "context", "mojito-custom-mojito-abc123.json");
  expect(JSON.parse(readFileSync(p, "utf8")).images).toEqual(["https://uploads.linear.app/a.png"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/server/launchContext.test.ts tests/server/launch.test.ts`
Expected: FAIL — type error / assertion mismatch on `images`.

- [ ] **Step 3: Add `images` to `NewTicketContext`.** In `src/server/launchContext.ts`:

```ts
export interface NewTicketContext {
  brief: string;
  project: string | null;
  images: string[];
}
```

- [ ] **Step 4: Add `images` to the launch request and pass it through.** In `src/server/launch.ts`, extend the interface:

```ts
export interface NewTicketLaunchRequest {
  brief: string;
  projectName: string | null;
  model: string;
  effort: Effort;
  images?: string[];
}
```
and change the `writeNewTicketContext` call (currently line ~214):
```ts
const contextPath = writeNewTicketContext(deps.stateDir, id, {
  brief: req.brief,
  project: req.projectName,
  images: req.images ?? [],
});
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npx vitest run tests/server/launchContext.test.ts tests/server/launch.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the cross-repo contract doc.** In `CLAUDE.md` section **1b. New-ticket context**, update the `LIME_NEW_CONTEXT` shape from `{ brief, project }` to `{ brief, project, images }` and note `images` is a list of Linear asset URLs the session appends to the created description.

- [ ] **Step 7: Commit.**

```bash
git add src/server/launchContext.ts src/server/launch.ts tests/server/launchContext.test.ts tests/server/launch.test.ts CLAUDE.md
git commit -m "feat(mojito): thread image URLs through LIME_NEW_CONTEXT (RIC-133)"
```

---

## Task 5: Wire the `/api/sessions` new-ticket branch to upload images

**Files:**
- Modify: `src/app/api/sessions/route.ts`

**Interfaces:**
- Consumes: `validateImages` (Task 3), `uploadImage` (Task 2), `launchNewTicketSession` with `images` (Task 4), `cfg.linearApiKey`.
- Produces: no new exports (route behavior).

This route has no unit-test harness in the repo; correctness rests on the tested helpers (Tasks 2–4) plus the typecheck and the manual E2E in Task 8. Keep the branch thin — validate, upload, delegate.

- [ ] **Step 1: Add imports.** At the top of `src/app/api/sessions/route.ts`:

```ts
import { launchSession, launchCustomSession, launchNewTicketSession } from "@/server/launch";
import { validateImages } from "@/server/imageUpload";
import { uploadImage } from "@/server/linear";
```
(Extend the existing `@/server/launch` import; add the two new imports.)

- [ ] **Step 2: Replace the `new-ticket` branch body** with:

```ts
if (body.kind === "new-ticket") {
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return NextResponse.json({ error: "empty brief" }, { status: 400 });
  const parsed = validateImages(body.images);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(parsed.files.map((f) => uploadImage(cfg.linearApiKey, f)));
  } catch {
    return NextResponse.json({ error: "image upload failed" }, { status: 502 });
  }
  const res = await launchNewTicketSession(
    { brief, projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high", images: imageUrls },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json(res.meta, { status: 201 });
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors. (`DecodedImage.bytes` is a `Buffer`, assignable to `uploadImage`'s `Uint8Array` param.)

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/sessions/route.ts
git commit -m "feat(mojito): upload new-ticket images to Linear before launch (RIC-133)"
```

---

## Task 6: Client — capture, thumbnails, submit

**Files:**
- Modify: `src/components/NewTicketSheet.tsx`

**Interfaces:**
- Consumes: `ALLOWED_IMAGE_TYPES`, `MAX_IMAGE_BYTES`, `MAX_IMAGES` from `@/lib/imageConstants`; the `.thumbs`/`.thumb` classes from Task 7.
- Produces: the POST body now includes `images: { name: string; type: string; dataUrl: string }[]`.

No automated test (browser UI). Keep logic thin; the server re-validates.

- [ ] **Step 1: Replace `src/components/NewTicketSheet.tsx`** with the version below (adds image state, three capture paths, a thumbnail strip, client-side validation, and `images` in the POST):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";
import type { SessionMeta } from "@/server/types";

const MODELS = ["opus", "sonnet", "fable"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GENERAL = "__general__";

interface PendingImage { id: string; name: string; type: string; dataUrl: string; }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function NewTicketSheet(
  { token, onClose, onCreated }:
  { token: string; onClose: () => void; onCreated: (meta: SessionMeta) => void },
) {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(GENERAL);
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState("opus");
  const [effort, setEffort] = useState("high");
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
    const decoded: PendingImage[] = await Promise.all(picked.map(async (f) => ({
      id: crypto.randomUUID(), name: f.name || "image", type: f.type, dataUrl: await readAsDataUrl(f),
    })));
    setImages((prev) => [...prev, ...decoded]);
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
      const res = await apiFetch(token, "/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          kind: "new-ticket", brief: brief.trim(),
          projectName: project === GENERAL ? null : project, model, effort,
          images: images.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })),
        }),
      });
      if (!res.ok) { setErr(await res.text()); return; }
      const meta: SessionMeta = await res.json();
      onCreated(meta);
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
        <label className="field"><span className="lbl">Description</span>
          <textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} onPaste={onPaste}
            placeholder="Describe the ticket — Claude will turn it into a title + description. Paste or drop images." />
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
        <div className="two">
          <label className="field"><span className="lbl">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field"><span className="lbl">Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <button className="btn primary block" disabled={!brief.trim() || isSubmitting} onClick={create}>Create ticket</button>
        {err && <p className="err-text">{err}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/NewTicketSheet.tsx
git commit -m "feat(mojito): paste/pick/drop images in the new-ticket form (RIC-133)"
```

---

## Task 7: CSS — full-width textarea + thumbnail styles

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Make the textarea full width.** Change the rule at `src/app/globals.css:198` from:

```css
.field select, .field input { width: 100%; }
```
to:
```css
.field select, .field input, .field textarea { width: 100%; }
```

- [ ] **Step 2: Add image UI styles** just after the `.err-text` rule (around line 204):

```css
.img-row { margin: 0 0 12px; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.thumb { position: relative; width: 64px; height: 64px; border-radius: var(--r-sm);
  overflow: hidden; border: 1px solid var(--border-hi); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 16px;
  padding: 0; border-radius: 50%; border: none; background: rgba(0, 0, 0, .6); color: #fff;
  font-size: 14px; cursor: pointer; }
```

- [ ] **Step 3: Full test run + visual check.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 0 failures.
Visual: open the app, tap "New ticket" — the Description textarea now spans full width; "Add image", paste, and drop all add thumbnails; the × removes one.

- [ ] **Step 4: Commit.**

```bash
git add src/app/globals.css
git commit -m "fix(mojito): full-width new-ticket textarea + image thumbnail styles (RIC-133)"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm the lime plugin cache is updated** (Task 1, Step 6) — `ls ~/.claude/plugins/cache/lime/lime/` shows the new version. Without it the created ticket will not embed images even though upload succeeds.

- [ ] **Step 2: Full green build.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 0 failures.

- [ ] **Step 3: Manual E2E.** In the running app: New ticket → type a brief → paste a screenshot and add one via the picker → Create. Confirm the `/lime-new` session creates a Backlog ticket whose description ends with the pasted image(s) rendered inline (open the ticket in Linear).

- [ ] **Step 4 (self-check on completion):** all tasks committed, `git log --oneline` shows the sequence, working tree clean.
