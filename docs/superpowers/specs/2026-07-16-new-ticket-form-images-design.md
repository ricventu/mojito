# RIC-133 — New-ticket form: full width + image insert

## Summary

Two improvements to the "New ticket" form (`NewTicketSheet`):

1. **Width fix** — the Description `<textarea>` renders at its intrinsic ~20-column
   width while every other control is full width. Make it full width.
2. **Image insert** — let the user add images to the ticket via clipboard paste, a file
   picker, and drag & drop. Mojito's server uploads them to Linear and they appear
   **inline in the created ticket's description**.

This is a **cross-repo** change. Per Mojito's `CLAUDE.md`, the `lime` change lands first,
then Mojito is adapted to it.

## Background / current state

The new-ticket flow:

```
NewTicketSheet (brief text)
  → POST /api/sessions { kind:"new-ticket", brief, projectName, model, effort }
    → launchNewTicketSession writes LIME_NEW_CONTEXT { brief, project }
      → spawns `claude … /lime-new`
        → /lime-new analyzes the brief → creates a Backlog Linear ticket (title + description)
```

Relevant code:
- `src/components/NewTicketSheet.tsx` — the form.
- `src/app/globals.css` — `.field select, .field input { width: 100%; }` (line ~198) omits `textarea`.
- `src/app/api/sessions/route.ts` — the `new-ticket` POST branch.
- `src/server/launch.ts` — `launchNewTicketSession`.
- `src/server/launchContext.ts` — `NewTicketContext` + `writeNewTicketContext`.
- `src/server/linear.ts` — server-side Linear GraphQL client (`LINEAR_API_KEY`), already
  does `listOpenIssues` / `getIssueStatus` / `setIssueStatus` / `postComment`.
- lime: `skills/lime-new/SKILL.md` (separate repo at `/Users/ricventu/code/Lime/lime`).

Mojito's server already has direct Linear access, so it can upload images itself rather
than delegating the upload to the `/lime-new` session.

## Requirement 1 — Textarea width

**Root cause:** `.field select, .field input { width: 100%; }` targets `select` and `input`
but not `textarea`, so the Description field keeps its default intrinsic width.

**Fix:** include `textarea` in the full-width rule (e.g. `.field select, .field input,
.field textarea { width: 100%; }`), keeping the existing `resize: vertical` behavior.
CSS-only; verified visually.

## Requirement 2 — Image insert (inline in description)

### Data flow

```
NewTicketSheet (data URLs held in state)
  → POST /api/sessions { kind:"new-ticket", brief, projectName, model, effort, images:[dataUrl] }
    → server: validate images → linear.uploadImage() per image → Linear asset URLs
      → LIME_NEW_CONTEXT { brief, project, images:[assetUrl] }
        → /lime-new appends ![](assetUrl) at the end of the analyzed description
          → Backlog ticket with inline screenshots
```

### 2a. Client — `NewTicketSheet.tsx`

- New state: `images: { id: string; name: string; type: string; dataUrl: string }[]`.
- Three capture paths:
  - **Clipboard paste** — `onPaste` on the textarea reads `e.clipboardData.items`,
    filters image types, reads each as a data URL.
  - **File picker** — a hidden `<input type="file" accept="image/*" multiple>` behind an
    "Add image" button.
  - **Drag & drop** — `onDragOver` / `onDrop` on the sheet (or description area) reads
    dropped image files.
- **Thumbnail strip** below the textarea; each thumbnail has a remove (×) button.
- **Client validation** (defense-in-depth; server is authoritative): image types only,
  per-image size cap, max count. Violations surface via the existing `.err-text`.
- **Submit** includes `images` (array of `{ name, type, dataUrl }`) in the existing JSON
  POST body. Keep the current `isSubmitting` double-submit guard; disable the button while
  the request (which now includes uploads) is in flight.

### 2b. API — `/api/sessions` POST, `new-ticket` branch

- Accept optional `images`. **Server-side validation is authoritative:** it must be an
  array; each entry must be a data URL / base64 with a `type` in the allowlist
  (`image/png`, `image/jpeg`, `image/gif`, `image/webp`); per-image size within the cap;
  count within the cap. On violation → `400`/`422` with a message.
- Decode base64 → call `linear.uploadImage()` for each → collect asset URLs.
- Pass the asset URLs to `launchNewTicketSession`.
- **Atomicity:** if any upload fails, fail the whole create (`502`/`422`) and do **not**
  spawn a session, so the user can retry cleanly.

### 2c. Server — `src/server/linear.ts`

New helper:

```
uploadImage(
  apiKey: string,
  file: { filename: string; contentType: string; size: number; bytes: Uint8Array | Buffer },
  fetchImpl: typeof fetch = fetch,
): Promise<string /* assetUrl */>
```

Implementation:
1. GraphQL `fileUpload(size, contentType, filename)` →
   `{ success, uploadFile { uploadUrl, assetUrl, headers { key, value } } }`.
2. PUT the raw bytes to `uploadUrl` with the returned `headers` plus `Content-Type:
   contentType`.
3. Return `assetUrl` (a stable `uploads.linear.app/...` URL — the same kind Linear
   embeds for pasted screenshots).

Follows the existing `query()` / `fetchImpl` injection pattern so it is unit-testable.

### 2d. Launch context — `launchContext.ts` + `launch.ts`

- Extend `NewTicketContext` with `images: string[]` (Linear asset URLs).
- `writeNewTicketContext` writes the field.
- `launchNewTicketSession` accepts `images` and passes them into the context.

### 2e. lime-new (separate repo — lands FIRST)

- `skills/lime-new/SKILL.md`:
  - Step 1.0 (context read): `LIME_NEW_CONTEXT` may include `images: string[]` (asset URLs).
  - Step 3 (create): after producing the analyzed description, append each image as
    `![](url)` on its own line at the **end** of the description. Deterministic placement,
    immune to the mini-analysis rewrite.
  - Update the guard summary if needed.
- Bump `.claude-plugin/plugin.json` version; rebuild the plugin cache via `/plugin`;
  confirm `ls ~/.claude/plugins/cache/lime/lime/` shows the new version.
- Update Mojito `CLAUDE.md` contract **1b** (document the new `images` field) and lime's
  `README.md` if it documents the context.

## Error handling

- Client validation → `.err-text`.
- Server validation / Linear upload failure → error response, surfaced in the sheet;
  no session spawned on failure.
- Size and count caps enforced on **both** client and server.

## Testing

- `linear.uploadImage` — mock `fetch`: asserts the `fileUpload` mutation is sent, the PUT
  targets `uploadUrl` with the returned headers, returns `assetUrl`; error path throws.
- `/api/sessions` new-ticket branch — image validation (bad type, too large, too many) →
  error; happy path uploads and threads asset URLs into the launch.
- `launchContext` / `launch` — `images` land in the written `LIME_NEW_CONTEXT` file.
- No automated tests for CSS or the paste/drag UI — keep client logic thin; verify the
  width fix and capture paths visually.

Run: `npx tsc --noEmit && npx vitest run`.

## Scope / YAGNI

- Images append at the **end** of the description (plain `<textarea>`, no rich-text editor,
  no inline-cursor placement).
- No image editing, cropping, captions, or reordering.

## Decided defaults

- **Caps:** 10 MB per image, up to 10 images per ticket.
- **Types:** `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- **Placement:** all images at the end of the created description.

## Sequencing (per Mojito CLAUDE.md: change lime first)

1. lime-new SKILL change + version bump + plugin-cache rebuild (2e).
2. Mojito server: `linear.uploadImage` (2c) + context threading (2d) + API branch (2b).
3. Mojito client: capture paths + thumbnails + submit (2a).
4. Width fix (1) — independent; can land anytime.
5. Docs: Mojito `CLAUDE.md` contract 1b + lime README.
