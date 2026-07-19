# Terminal image attach (console prompt) — design

## Problem

On mobile, a user wants to attach an image (e.g. a screenshot) to the running
Claude Code session shown in Mojito's terminal. The text-paste feature
(`2026-07-19-terminal-mobile-paste-design.md`) forwards bytes to the pty, but an
image cannot travel the same way.

Verified facts about how Claude Code (in the terminal) ingests images (confirmed via
the claude-code-guide):

1. **Clipboard paste (Ctrl/Cmd+V) reads the LOCAL OS clipboard** (`pbpaste` etc.),
   NOT the PTY byte stream. So a phone's clipboard image can never reach Claude Code
   running on the Mac through the terminal — remote clipboard paste is impossible.
2. **A file path in the prompt works.** If an absolute image path (`.png`/`.jpg`/
   `.gif`/`.webp`, max 5 MB) appears in the prompt text, Claude Code detects it by
   extension and loads the image. No special syntax, no `@` prefix.
3. There is no PTY-level image protocol (no SIXEL/iTerm2 injection).

Therefore the only viable path: **upload the image from the phone to the Mac (the
Mojito server), write it to a file Claude Code can read, and inject that file's
absolute path into the prompt as text.**

Scope: **console/terminal image attach only.** New-ticket image paste already exists
and is unchanged.

## Approach

Add a `📎` button to the terminal's `AccessoryBar` next to the existing `📋` (text)
button. It opens the native file picker (`<input type="file" accept="image/*"
multiple>` — on iOS this includes screenshots from Photos). The picked images are
uploaded to a new server endpoint, which writes each into the session's working
directory and returns absolute paths; the client injects the paths into the prompt
via the existing `term.paste()` channel. The user then types their question and
presses Enter.

Rejected: clipboard paste into a `contenteditable` — iOS image-paste is unreliable and
would complicate the text field; the file picker (Photos) is robust and works over
plain HTTP. (User chose to keep `📋` text and add a separate `📎` picker.)

## Why store in the session cwd

Claude Code always has read access to its working directory, so reading an image from
`<cwd>/...` triggers **no permission prompt** and works on already-running sessions.
Storing outside the cwd (a temp dir) could prompt for permission on existing sessions.
Trade-off accepted: files land in the repo, mitigated by a dedicated ignored subdir.

## Components

### `src/lib/readAsDataUrl.ts` (extracted, shared)
`readAsDataUrl(file: File): Promise<string>` — currently inlined in
`NewTicketSheet.tsx`. Extract it to a shared module; import from both `NewTicketSheet`
and `TerminalView`. No behavior change.

### `src/lib/pastedImagePath.ts` (pure, testable)
Two pure helpers used server-side to build the storage path:

- `extForType(type: string): string | null` — maps a content type to a file
  extension: `image/png`→`.png`, `image/jpeg`→`.jpg`, `image/gif`→`.gif`,
  `image/webp`→`.webp`; `null` for anything else.
- `pastedImageDir(cwd: string, sessionId: string): string` — returns
  `<cwd>/.mojito/pasted/<sessionId>`. Per-session subdir so two sessions sharing a
  repo cwd never collide or clean up each other's files.

### `src/server/pasteImageStore.ts` (server I/O)
`storePastedImages(cwd, sessionId, images): { paths: string[] }` (or an error):
- Ensures `<cwd>/.mojito/.gitignore` exists containing `*` (so the repo stays clean
  without touching the root `.gitignore`).
- Ensures `<cwd>/.mojito/pasted/<sessionId>/` exists.
- For each validated image: writes bytes to a unique filename
  (`<random>.<ext>` via `extForType`), returns its absolute path.
- `cleanupPastedImages(cwd, sessionId)`: `rm -rf <cwd>/.mojito/pasted/<sessionId>/`.

Validation reuses `src/server/imageUpload.ts` (`parseDataUrl`, type/size checks) but
enforces a **5 MB** cap (Claude Code's limit), not the 10 MB new-ticket cap.

### New endpoint: `POST /api/sessions/:id/paste-image`
- Auth: same token gate as the other `/api/sessions/:id` routes.
- Body: `{ images: [{ name, type, dataUrl }] }`.
- Looks up the session in the registry to get its `cwd` (404 if unknown; 400 if the
  session has no cwd).
- Validates + stores via `pasteImageStore`; returns `{ paths: string[] }`
  (400 with a clear message on unsupported type / too-large / malformed).

### `src/components/AccessoryBar.tsx`
- Add a `📎` button + a hidden `<input type="file" accept="image/*" multiple>`.
- On change: call `onPickImages(files: File[])`, then reset `input.value`.
- New required prop `onPickImages: (files: File[]) => void` (alongside `onSend`,
  `onPasteText`).

### `src/components/TerminalView.tsx`
- Implement `onPickImages`: read each file with `readAsDataUrl`, POST to
  `/api/sessions/:id/paste-image`, then inject the returned paths:
  `termRef.current?.paste(quotePaths(paths).join(" ") + " ")`.
- Wire cleanup: when a session is deleted/killed, the server removes its paste subdir
  (the DELETE handler calls `cleanupPastedImages`). (Client `kill` already hits
  DELETE `/api/sessions/:id`.)
- Paths containing spaces are wrapped in double quotes before injection.

## Data flow

1. Tap `📎` → native picker → user selects image(s).
2. Client reads each to a data URL, POSTs `{ images }` to
   `/api/sessions/:id/paste-image`.
3. Server: look up cwd → validate (≤5 MB, allowed type) → ensure `.mojito/.gitignore`
   + `.mojito/pasted/<sessionId>/` → write files → return absolute `paths`.
4. Client injects `paths` (space-joined, quoted if needed, trailing space) into the
   terminal via `term.paste`.
5. User types a question and presses `⏎`; Claude Code reads the image file(s).
6. On session delete/kill, the server removes `<cwd>/.mojito/pasted/<sessionId>/`.

## Error handling

- Unsupported type (e.g. iOS HEIC screenshot): server returns 400 "unsupported image
  type: <type>"; client shows it as a transient inline error line rendered just above
  the accessory bar (reusing the `.err-text` style from `NewTicketSheet`), cleared on
  the next pick or after a few seconds. This is the most likely real-world failure —
  surface it clearly.
- Image > 5 MB: 400 "image too large (max 5 MB)".
- Malformed data URL / type mismatch: 400 "malformed image data".
- Unknown session / no cwd: 404 / 400 respectively.
- File write failure: 500 with a generic message; nothing injected.
- `termRef.current` null (torn down mid-upload): `?.paste` no-ops.

## Testing

- **Unit (vitest, node):**
  - `extForType`: each allowed type → extension; unknown → null.
  - `pastedImageDir`: builds `<cwd>/.mojito/pasted/<sessionId>` for representative
    inputs.
  - `pasteImageStore` (using a temp dir as `cwd`): writes files with correct
    extensions, creates `.mojito/.gitignore` with `*`, returns absolute paths under
    the per-session dir; `cleanupPastedImages` removes only that session's subdir;
    5 MB cap and unsupported-type rejection.
  - Endpoint handler: happy path returns paths; unsupported type / oversize / unknown
    session return the right status + message (mirrors existing API-route tests).
- **Manual (required, on device):** iOS Safari over the LAN IP — tap `📎`, pick a
  screenshot, confirm the path is injected into the prompt, type a question, send, and
  confirm Claude Code loads the image. Also confirm the HEIC-rejection error path is
  legible.

## Out of scope

- Clipboard image paste into the terminal (impossible remotely; file picker replaces
  it).
- New-ticket image handling (unchanged).
- Converting HEIC → a supported type server-side (future enhancement; for now reject
  with a clear message).

## Branch

Stacked on `ricventu/mobile-terminal-paste` (the text-paste branch): same files
(`AccessoryBar`, `TerminalView`), same theme. Merges together after on-device
verification. Text commits remain cherry-pickable if the two need to split.
