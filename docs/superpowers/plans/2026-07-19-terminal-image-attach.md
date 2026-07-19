# Terminal Image Attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a mobile user attach image(s) to the running Claude Code session by picking them in the terminal's accessory bar; Mojito uploads them into the session's working tree and injects their file paths into the prompt.

**Architecture:** A `📎` button in `AccessoryBar` opens the native file picker. Picked images POST to a new `POST /api/sessions/:id/paste-image` endpoint, which validates them (reusing `imageUpload.ts`, capped at 5 MB — Claude Code's limit), writes each into `<cwd>/.mojito/pasted/<sessionId>/`, and returns absolute paths. The client injects the paths via the existing `term.paste()` channel; Claude Code reads image files by path. Files are stored in the session cwd (always readable by Claude Code — no permission prompt) and cleaned up when the session is deleted.

**Tech Stack:** TypeScript, React ("use client" components), Next.js route handlers, node:fs/path/crypto, xterm.js, vitest.

## Global Constraints

- All code artifacts (identifiers, comments, strings) in **English**. Server error strings stay English and match existing style in `imageUpload.ts` (e.g. `unsupported image type: <type>`).
- Terminal images are capped at **5 MB** (`CLAUDE_IMAGE_MAX_BYTES`), Claude Code's per-image limit — NOT the 10 MB new-ticket cap. New-ticket behavior is unchanged.
- Store images at **`<cwd>/.mojito/pasted/<sessionId>/<randomUUID><ext>`**; ensure **`<cwd>/.mojito/.gitignore`** contains `*` so the repo's git status stays clean.
- Inject paths via `termRef.current?.paste(...)` (never a raw ws send); wrap any path containing whitespace in double quotes.
- Import conventions: `@/*` → `src/*` (alias imports omit `.js`); relative imports **within `src/server`** use a `.js` suffix (e.g. `./imageUpload.js`).
- API route handlers are thin glue and are NOT unit-tested in this repo (only `healthRoute` is). The testable logic lives in `src/lib` and `src/server` modules. Route correctness is gated by `tsc` + those modules' tests + manual verification.
- Full check command: `npx tsc --noEmit && npx vitest run`.

---

### Task 1: Pure helpers (path/ext + arg quoting + 5 MB constant)

**Files:**
- Modify: `src/lib/imageConstants.ts`
- Create: `src/lib/pastedImagePath.ts`
- Create: `src/lib/quoteArg.ts`
- Test: `tests/lib/pastedImagePath.test.ts`, `tests/lib/quoteArg.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CLAUDE_IMAGE_MAX_BYTES: number` (= 5 MB) in `imageConstants.ts`
  - `extForType(type: string): string | null` — content type → file extension, else null
  - `pastedImageDir(cwd: string, sessionId: string): string` — `<cwd>/.mojito/pasted/<sessionId>`
  - `quoteArg(arg: string): string` — double-quotes `arg` iff it contains whitespace

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/pastedImagePath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extForType, pastedImageDir } from "@/lib/pastedImagePath";

describe("extForType", () => {
  it("maps each Claude-supported type to an extension", () => {
    expect(extForType("image/png")).toBe(".png");
    expect(extForType("image/jpeg")).toBe(".jpg");
    expect(extForType("image/gif")).toBe(".gif");
    expect(extForType("image/webp")).toBe(".webp");
  });
  it("returns null for an unsupported type", () => {
    expect(extForType("image/svg+xml")).toBeNull();
    expect(extForType("image/heic")).toBeNull();
    expect(extForType("")).toBeNull();
  });
});

describe("pastedImageDir", () => {
  it("builds a per-session dir under <cwd>/.mojito/pasted", () => {
    expect(pastedImageDir("/repo", "mojito-RIC-1-to-code")).toBe("/repo/.mojito/pasted/mojito-RIC-1-to-code");
  });
});
```

Create `tests/lib/quoteArg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { quoteArg } from "@/lib/quoteArg";

describe("quoteArg", () => {
  it("leaves a whitespace-free arg unchanged", () => {
    expect(quoteArg("/repo/.mojito/pasted/s/abc.png")).toBe("/repo/.mojito/pasted/s/abc.png");
  });
  it("double-quotes an arg containing a space", () => {
    expect(quoteArg("/My Repo/img.png")).toBe('"/My Repo/img.png"');
  });
  it("double-quotes an arg containing a tab", () => {
    expect(quoteArg("a\tb")).toBe('"a\tb"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/pastedImagePath.test.ts tests/lib/quoteArg.test.ts`
Expected: FAIL — cannot resolve `@/lib/pastedImagePath` / `@/lib/quoteArg`.

- [ ] **Step 3: Write the implementations**

Append to `src/lib/imageConstants.ts` (keep the existing lines):

```ts
export const CLAUDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // Claude Code's per-image limit
```

Create `src/lib/pastedImagePath.ts`:

```ts
import { join } from "node:path";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

// File extension Claude Code needs to recognize a file as an image, derived from its
// content type. Returns null for a type Claude Code cannot read.
export function extForType(type: string): string | null {
  return EXT_BY_TYPE[type] ?? null;
}

// Per-session storage dir inside the session's working tree. Claude Code always has
// read access to its cwd, so an injected path here needs no permission prompt. The
// per-session segment keeps two sessions sharing one repo from colliding or cleaning
// up each other's files.
export function pastedImageDir(cwd: string, sessionId: string): string {
  return join(cwd, ".mojito", "pasted", sessionId);
}
```

Create `src/lib/quoteArg.ts`:

```ts
// Wrap a prompt argument in double quotes only when it contains whitespace, so an
// injected file path with spaces reaches Claude Code as a single token.
export function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/pastedImagePath.test.ts tests/lib/quoteArg.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/imageConstants.ts src/lib/pastedImagePath.ts src/lib/quoteArg.ts tests/lib/pastedImagePath.test.ts tests/lib/quoteArg.test.ts
git commit -m "feat(mojito): pure helpers for terminal image attach"
```

---

### Task 2: Image validation cap + storage module

**Files:**
- Modify: `src/server/imageUpload.ts`
- Test: `tests/server/imageUpload.test.ts` (add cases)
- Create: `src/server/pasteImageStore.ts`
- Test: `tests/server/pasteImageStore.test.ts`

**Interfaces:**
- Consumes: `extForType`, `pastedImageDir` (`@/lib/pastedImagePath`); `CLAUDE_IMAGE_MAX_BYTES` (`@/lib/imageConstants`); `DecodedImage`, `validateImages` (`./imageUpload.js`).
- Produces:
  - `validateImages(input: unknown, maxBytes?: number)` — now takes an optional byte cap (default `MAX_IMAGE_BYTES`).
  - `storePastedImages(cwd: string, sessionId: string, files: DecodedImage[]): { paths: string[] }`
  - `cleanupPastedImages(cwd: string, sessionId: string): void`

- [ ] **Step 1: Add the maxBytes param to `validateImages`**

In `src/server/imageUpload.ts`, change the signature and the size check. Replace:

```ts
export function validateImages(
  input: unknown,
): { ok: true; files: DecodedImage[] } | { ok: false; error: string } {
```

with:

```ts
export function validateImages(
  input: unknown,
  maxBytes: number = MAX_IMAGE_BYTES,
): { ok: true; files: DecodedImage[] } | { ok: false; error: string } {
```

and replace the oversize check:

```ts
    if (parsed.bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image too large (max ${MAX_IMAGE_BYTES} bytes)` };
    }
```

with:

```ts
    if (parsed.bytes.length > maxBytes) {
      return { ok: false, error: `image too large (max ${maxBytes} bytes)` };
    }
```

(The default keeps the existing 10 MB behavior and error string, so current callers and tests are unaffected.)

- [ ] **Step 2: Add tests for the cap param**

In `tests/server/imageUpload.test.ts`, add an import and two cases inside the `describe`:

```ts
import { CLAUDE_IMAGE_MAX_BYTES } from "@/lib/imageConstants";
```

```ts
  it("accepts an image within an explicit smaller cap", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: png(tiny) }], CLAUDE_IMAGE_MAX_BYTES);
    expect(res.ok).toBe(true);
  });

  it("rejects an image over an explicit smaller cap", () => {
    const big = Buffer.alloc(CLAUDE_IMAGE_MAX_BYTES + 1).toString("base64");
    const res = validateImages([{ name: "big.png", type: "image/png", dataUrl: png(big) }], CLAUDE_IMAGE_MAX_BYTES);
    expect(res).toEqual({ ok: false, error: "image too large (max 5242880 bytes)" });
  });
```

- [ ] **Step 3: Run the imageUpload tests (RED for new cases first, then GREEN)**

Run: `npx vitest run tests/server/imageUpload.test.ts`
Expected after Steps 1–2: PASS (existing 9 + new 2). If you wrote the tests before Step 1's signature change, the two new cases fail to typecheck/behave until the param exists — confirm they pass after Step 1.

- [ ] **Step 4: Write the failing storage test**

Create `tests/server/pasteImageStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storePastedImages, cleanupPastedImages } from "@/server/pasteImageStore";
import type { DecodedImage } from "@/server/imageUpload";

function img(type: string, byte: number): DecodedImage {
  const bytes = Buffer.from([byte]);
  return { filename: "x", contentType: type, size: bytes.length, bytes };
}

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "mojito-paste-")); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe("storePastedImages", () => {
  it("writes files with the right extension under the per-session dir and returns absolute paths", () => {
    const { paths } = storePastedImages(cwd, "sess-1", [img("image/png", 1), img("image/webp", 2)]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^${cwd}/\\.mojito/pasted/sess-1/[^/]+\\.png$`));
    expect(paths[1].endsWith(".webp")).toBe(true);
    expect(existsSync(paths[0])).toBe(true);
    expect(readFileSync(paths[0])).toEqual(Buffer.from([1]));
  });

  it("creates .mojito/.gitignore with '*'", () => {
    storePastedImages(cwd, "sess-1", [img("image/png", 1)]);
    expect(readFileSync(join(cwd, ".mojito", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("cleanup removes only that session's dir", () => {
    storePastedImages(cwd, "sess-1", [img("image/png", 1)]);
    storePastedImages(cwd, "sess-2", [img("image/png", 1)]);
    cleanupPastedImages(cwd, "sess-1");
    expect(existsSync(join(cwd, ".mojito", "pasted", "sess-1"))).toBe(false);
    expect(existsSync(join(cwd, ".mojito", "pasted", "sess-2"))).toBe(true);
  });

  it("cleanup is a no-op when the dir does not exist", () => {
    expect(() => cleanupPastedImages(cwd, "never")).not.toThrow();
  });
});
```

- [ ] **Step 5: Run the storage test to verify it fails**

Run: `npx vitest run tests/server/pasteImageStore.test.ts`
Expected: FAIL — cannot resolve `@/server/pasteImageStore`.

- [ ] **Step 6: Write the storage module**

Create `src/server/pasteImageStore.ts`:

```ts
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DecodedImage } from "./imageUpload.js";
import { extForType, pastedImageDir } from "@/lib/pastedImagePath";

// Write validated images into the session's per-session paste dir and return their
// absolute paths for injection into the prompt. A `.mojito/.gitignore` (`*`) keeps
// the files out of the repo's git status without touching the root .gitignore.
export function storePastedImages(
  cwd: string,
  sessionId: string,
  files: DecodedImage[],
): { paths: string[] } {
  const mojitoDir = join(cwd, ".mojito");
  mkdirSync(mojitoDir, { recursive: true });
  const gitignore = join(mojitoDir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");

  const dir = pastedImageDir(cwd, sessionId);
  mkdirSync(dir, { recursive: true });

  const paths: string[] = [];
  for (const f of files) {
    const ext = extForType(f.contentType);
    if (!ext) continue; // validateImages already gated on allowed types; defensive
    const p = join(dir, `${randomUUID()}${ext}`);
    writeFileSync(p, f.bytes);
    paths.push(p);
  }
  return { paths };
}

// Remove a session's paste dir on teardown. Best-effort (force: true → no throw if
// the dir never existed).
export function cleanupPastedImages(cwd: string, sessionId: string): void {
  rmSync(pastedImageDir(cwd, sessionId), { recursive: true, force: true });
}
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS — new `pasteImageStore` + `imageUpload` cases green, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/server/imageUpload.ts tests/server/imageUpload.test.ts src/server/pasteImageStore.ts tests/server/pasteImageStore.test.ts
git commit -m "feat(mojito): 5MB cap param + paste-image storage module"
```

---

### Task 3: paste-image endpoint + delete cleanup

**Files:**
- Create: `src/app/api/sessions/[id]/paste-image/route.ts`
- Modify: `src/app/api/sessions/[id]/route.ts`

**Interfaces:**
- Consumes: `getConfig`, `getRegistry` (`@/server/app`); `tokenFromHeaders` (`@/server/auth`); `validateImages` (`@/server/imageUpload`); `storePastedImages`, `cleanupPastedImages` (`@/server/pasteImageStore`); `CLAUDE_IMAGE_MAX_BYTES` (`@/lib/imageConstants`); `SessionMeta.cwd` from the registry.
- Produces: `POST /api/sessions/:id/paste-image` → `{ paths: string[] }`; `DELETE /api/sessions/:id` also removes the session's paste dir.

- [ ] **Step 1: Create the endpoint**

Create `src/app/api/sessions/[id]/paste-image/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { validateImages } from "@/server/imageUpload";
import { storePastedImages } from "@/server/pasteImageStore";
import { CLAUDE_IMAGE_MAX_BYTES } from "@/lib/imageConstants";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const meta = getRegistry().get(id);
  if (!meta) return new NextResponse("not found", { status: 404 });
  if (!meta.cwd) return new NextResponse("session has no working directory", { status: 400 });

  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const parsed = validateImages(body?.images, CLAUDE_IMAGE_MAX_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.files.length === 0) return NextResponse.json({ error: "no images" }, { status: 400 });

  let result;
  try {
    result = storePastedImages(meta.cwd, id, parsed.files);
  } catch {
    return NextResponse.json({ error: "failed to store image" }, { status: 500 });
  }
  return NextResponse.json({ paths: result.paths });
}
```

- [ ] **Step 2: Wire cleanup into DELETE**

In `src/app/api/sessions/[id]/route.ts`, add the import at the top (with the other `@/server` imports):

```ts
import { cleanupPastedImages } from "@/server/pasteImageStore";
```

Then in the `DELETE` handler, capture the session's cwd before removal and clean up after. Replace the body between the `const { id } = await params;` line and the `return`:

```ts
  const { id } = await params;
  const cwd = getRegistry().get(id)?.cwd;
  await closeSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  if (cwd) { try { cleanupPastedImages(cwd, id); } catch { /* best-effort */ } }
  return new NextResponse(null, { status: 204 });
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. (The routes are thin glue and per repo convention carry no unit test; their logic — validation and storage — is covered by Task 2's tests, and types are checked here.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/sessions/[id]/paste-image/route.ts" "src/app/api/sessions/[id]/route.ts"
git commit -m "feat(mojito): paste-image endpoint + delete cleanup"
```

---

### Task 4: Client — 📎 picker, upload, path injection, error line

**Files:**
- Create: `src/lib/readAsDataUrl.ts`
- Modify: `src/components/NewTicketSheet.tsx` (use the shared helper)
- Modify: `src/components/AccessoryBar.tsx`
- Modify: `src/components/TerminalView.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `readAsDataUrl` (`@/lib/readAsDataUrl`); `quoteArg` (`@/lib/quoteArg`); `apiFetch` (`@/lib/client`); the endpoint from Task 3; `AccessoryBar`'s new `onPickImages` prop.
- Produces: `AccessoryBar` gains a required prop `onPickImages: (files: File[]) => void`.

- [ ] **Step 1: Extract `readAsDataUrl`**

Create `src/lib/readAsDataUrl.ts`:

```ts
// Read a File into a base64 data URL. Shared by the New Ticket image picker and the
// terminal image-attach picker.
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
```

In `src/components/NewTicketSheet.tsx`, delete the local `readAsDataUrl` function (the `function readAsDataUrl(file: File): Promise<string> { … }` block) and add this import alongside the existing imports:

```ts
import { readAsDataUrl } from "@/lib/readAsDataUrl";
```

- [ ] **Step 2: Add the 📎 picker to `AccessoryBar`**

Replace the entire contents of `src/components/AccessoryBar.tsx` with:

```tsx
"use client";
import { useRef, useState } from "react";
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
  { onSend, onPasteText, onPickImages }:
  { onSend: (bytes: string) => void; onPasteText: (text: string) => void; onPickImages: (files: File[]) => void },
) {
  // Mobile paste: the terminal itself is a non-editable xterm canvas, so iOS offers
  // no "Incolla" on long-press. This reveals a real <textarea> the user can paste into
  // natively (works over plain HTTP, unlike navigator.clipboard), review/edit, then
  // inject into the terminal via xterm's own paste path.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const inject = () => {
    const text = normalizePaste(draft);
    // Empty / whitespace-only: no-op and keep the field open so the user can retry or
    // cancel. Only a real paste clears the draft and closes the field.
    if (!text) return;
    onPasteText(text);
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
        <button type="button" className="k" aria-label="Attach image" onClick={() => fileInput.current?.click()}>📎</button>
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
```

- [ ] **Step 3: Wire upload + injection + error line in `TerminalView`**

In `src/components/TerminalView.tsx`, add these imports alongside the existing ones:

```ts
import { readAsDataUrl } from "@/lib/readAsDataUrl";
import { quoteArg } from "@/lib/quoteArg";
```

Add an error state next to the existing `const [auto, setAuto] = useState(session.autoAdvance);`:

```ts
  const [imgErr, setImgErr] = useState<string | null>(null);
```

Add an auto-dismiss effect (place it near the other small effects, e.g. after the tab-title effect):

```ts
  // Auto-dismiss the transient image-attach error.
  useEffect(() => {
    if (!imgErr) return;
    const t = setTimeout(() => setImgErr(null), 6000);
    return () => clearTimeout(t);
  }, [imgErr]);
```

Add the pick handler next to `send`/`toggleAuto`:

```ts
  const pickImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setImgErr(null);
    try {
      const payload = await Promise.all(images.map(async (f) => ({
        name: f.name || "image", type: f.type, dataUrl: await readAsDataUrl(f),
      })));
      const res = await apiFetch(token, `/api/sessions/${session.id}/paste-image`, {
        method: "POST", body: JSON.stringify({ images: payload }),
      });
      if (!res.ok) {
        let msg = "image upload failed";
        try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        setImgErr(msg);
        return;
      }
      const { paths } = (await res.json()) as { paths: string[] };
      if (paths.length) termRef.current?.paste(paths.map(quoteArg).join(" ") + " ");
    } catch {
      setImgErr("image upload failed");
    }
  };
```

Then update the render: replace the `<AccessoryBar … />` line

```tsx
      <AccessoryBar onSend={send} onPasteText={(t) => termRef.current?.paste(t)} />
```

with an error line + the new prop:

```tsx
      {imgErr && <div className="term-img-err err-text">{imgErr}</div>}
      <AccessoryBar onSend={send} onPasteText={(t) => termRef.current?.paste(t)} onPickImages={pickImages} />
```

- [ ] **Step 4: Add the error-line style**

In `src/app/globals.css`, after the `.paste-field .paste-input { … }` block added by the text-paste feature, add:

```css
.term-img-err { margin: 0; padding: 8px 10px; border-top: 1px solid var(--border); background: var(--surface); }
```

(The `.err-text` class already supplies the `var(--err)` color; `.term-img-err` only adds the row layout. Note `.err-text` sets `margin: 10px 0 0` — `.term-img-err`'s `margin: 0` after it overrides that for the in-bar placement.)

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors (the new required `onPickImages` prop is wired at the single `AccessoryBar` call site); all tests pass.

- [ ] **Step 6: Manual verification (controller-owned; on device)**

On iOS Safari over the LAN IP, open a session terminal:
1. Tap `📎` → native picker → choose a screenshot from Photos.
2. Confirm its absolute path is injected into the prompt (a `.png`/`.jpg` path under `.mojito/pasted/<sessionId>/`), with a trailing space.
3. Type a question, press `⏎`, and confirm Claude Code loads the image.
4. Pick a HEIC image (or force an unsupported type) → confirm the red error line appears with "unsupported image type: …" and auto-dismisses.
5. Kill the session → confirm `<cwd>/.mojito/pasted/<sessionId>/` is removed and the repo's `git status` is clean (`.mojito` ignored).

- [ ] **Step 7: Commit**

```bash
git add src/lib/readAsDataUrl.ts src/components/NewTicketSheet.tsx src/components/AccessoryBar.tsx src/components/TerminalView.tsx src/app/globals.css
git commit -m "feat(mojito): attach images to the console prompt from mobile"
```

---

## Self-Review

**Spec coverage:**
- `📎` button + native picker → Task 4, Step 2. ✓
- Upload endpoint, 5 MB cap, cwd storage, `.mojito/.gitignore` → Tasks 2–3. ✓
- Path injection via `term.paste`, quoting paths with spaces → Task 4, Step 3 (`quoteArg`) + Task 1. ✓
- Per-session dir + cleanup on delete → Task 2 (`pastedImageDir`, `cleanupPastedImages`) + Task 3 DELETE wiring. ✓
- Reuse `imageUpload.ts` with a 5 MB cap → Task 2, Step 1. ✓
- Extract `readAsDataUrl` shared with New Ticket → Task 4, Step 1. ✓
- Unsupported-type (HEIC) error surfaced as a transient line → Task 4, Steps 3–4; error string from the server via `validateImages`. ✓
- Testing: pure helpers (Task 1), validation cap + storage (Task 2), manual iOS (Task 4). ✓
- Out of scope (clipboard image paste, new-ticket changes beyond the extract) → untouched. ✓

**Placeholder scan:** none.

**Type consistency:** `onPickImages: (files: File[]) => void` matches between `AccessoryBar` and `TerminalView`. `storePastedImages`/`cleanupPastedImages`/`pastedImageDir`/`extForType`/`quoteArg`/`readAsDataUrl` signatures are identical where defined and consumed. `validateImages(input, maxBytes?)` default preserves existing callers. `{ paths: string[] }` is the shared endpoint/store shape.
