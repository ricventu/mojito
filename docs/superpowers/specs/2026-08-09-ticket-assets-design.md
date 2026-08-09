# Ticket images and attachments for the work session (RIC-177)

## Problem

A work session cannot see anything a ticket carries as a file.

**Description images.** `uploads.linear.app` URLs reach the session inside the
description text of the launch-context file, but Linear serves those assets only to
a request carrying an `Authorization` header. The session, by design, holds no Linear
credential — its prompt forbids touching Linear at all. It sees that an image exists
and nothing more. This includes images uploaded through Mojito's own New Ticket form,
which `POST /api/tickets` pushes to Linear and appends to the description as
`![](<assetUrl>)`.

**Attachments.** Linear's `Attachment` entity is never fetched. `getIssueDescription`
reads the `description` field alone, and `LaunchContext` has no field to put an
attachment in.

The gap predates the move to a Mojito-native lifecycle, but it is now structural:
sessions must not touch Linear, so nothing downstream of the launch can close it.

## Goals

1. A work session can open every image and every downloadable file the ticket carries,
   as local files, with the Read tool.
2. Linear links that are not downloadable (GitHub PR, Slack thread, Figma) reach the
   session as titled URLs, so it knows they exist.
3. No new failure mode at launch: an unreachable asset must not stop a session from
   starting.

**Non-goals.** Images in Linear *comments* — the ticket names two gaps, description and
attachments, and Mojito reads no comments anywhere today. Assets for the
conflict-resolution session — it reconciles a rebase, where ticket screenshots do not
help. Garbage collection of the state directory, which does not exist yet for context
files either.

## Design

Mojito does the work at launch, where the API key already lives. Assets land on disk
next to the context file, and the context file names them.

### Boundary

Linear I/O stays in the route layer, where `getIssueDescription` is called today.
`launch.ts` keeps knowing nothing about Linear: it receives ready `assets` and
`attachments` in the `LaunchRequest` and forwards them verbatim to `writeLaunchContext`.
`LaunchDeps` gains no API key.

### Data flow

```
POST /api/sessions                         verdict route → launchRework
        │                                            │
        └──────────────┬─────────────────────────────┘
                       ▼
        getIssueContent(apiKey, ticket)        one GraphQL round trip
                       │  { description, attachments: {title,url}[] }
                       ▼
        prepareTicketAssets({ stateDir, id, description, attachments, download })
                       │  · extract uploads.linear.app URLs from the description
                       │  · clear <stateDir>/context/<id>-assets/
                       │  · download each, best-effort, capped
                       ▼
        { assets: {url,localPath}[], attachments: {title,url,localPath?}[] }
                       ▼
        launchSession(req + assets + attachments)
                       ▼
        writeLaunchContext → <stateDir>/context/<id>.json
```

### `src/server/linear.ts`

**`getIssueContent(apiKey, identifier, fetchImpl) → { description, attachments }`**
replaces `getIssueDescription`. Both existing callers already wanted the description,
and one now also wants the attachments, so this is one round trip where two would
otherwise be needed — not a new function beside the old one. `getIssueDescription` is
removed along with its tests; its behaviour (missing issue throws, null description
degrades to `""`) is preserved in the replacement.

```graphql
query ($key: String!, $n: Float!) {
  issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
    nodes {
      description
      attachments(first: 25) { nodes { title url } }
    }
  }
}
```

An attachment with no `url` is dropped; a missing `title` degrades to `""`.

**`downloadLinearAsset(apiKey, url, fetchImpl) → { bytes, contentType }`** — GET with
`Authorization: <apiKey>`, `AbortSignal.timeout(15_000)`, redirects followed (Linear
redirects to a signed storage URL; `fetch` strips `Authorization` on the cross-origin
hop, which is correct — the target is pre-signed). Throws on non-2xx. Size is checked
twice: `content-length` before buffering, so an oversized asset costs nothing, and the
buffered length after, because the header is advisory. `contentType` is the response
header with its parameters stripped (`image/png; charset=…` → `image/png`).

### `src/server/ticketAssets.ts` (new)

One module, extraction and storage together — a single concern ("get a ticket's assets
onto disk") that stays well under 150 lines.

```ts
export interface TicketAsset { url: string; localPath: string }
export interface TicketAttachment { title: string; url: string; localPath?: string }

export function extractAssetUrls(description: string): string[]
export function isLinearUploadUrl(url: string): boolean
export function assetsDir(stateDir: string, id: string): string
export function clearTicketAssets(stateDir: string, id: string): void
export async function prepareTicketAssets(input: PrepareInput): Promise<PrepareResult>
```

**`extractAssetUrls`** is pure. It returns unique `https://uploads.linear.app/…` URLs in
order of first appearance, matching markdown images `![alt](url)`, markdown links
`[text](url)`, and bare URLs. The match stops at whitespace and at `)`, `]`, `"`, `'`,
`<`, `>`; a trailing `.,;:!?` is trimmed, since sentence punctuation is far more likely
than a URL genuinely ending in one.

**`isLinearUploadUrl`** requires the literal prefix `https://uploads.linear.app/`. The
mandatory `/` is what makes `https://uploads.linear.app.evil.com/x` fail to match.

**`prepareTicketAssets`** takes an injected
`download: (url) => Promise<{ bytes, contentType }>`, so no test touches the network. It:

1. Clears `<stateDir>/context/<id>-assets/` and recreates it `0o700`. Session ids repeat
   (a QA rework relaunches under the same `mojito-<ticket>-work` id), so without this a
   rework inherits the previous run's files — the same reasoning as `clearSessionResult`.
2. Builds the work list: every extracted description URL, then every attachment whose
   URL passes `isLinearUploadUrl`. Capped at `MAX_ASSETS = 20` in that order — description
   images are what a session most often needs.
3. Downloads each, writing `0o600` files. A failure (network, non-2xx, timeout, over
   `MAX_ASSET_BYTES = 10 MB`) drops that one asset and continues.
4. Returns `assets` (description uploads that downloaded) and `attachments` (every
   attachment, `localPath` present only on the ones that downloaded).

An empty result is returned as empty arrays; the caller omits the fields.

**Field naming.** The ticket sketched this field as `images`. Since the decision is to
download *every* `uploads.linear.app` upload and not only images — a log or a PDF
dropped into a description is exactly the kind of thing a session needs — `assets` is
the honest name, and it reads symmetrically with `attachments`.

**Filenames.** `NN-<basename>`, where `NN` is the 1-based index zero-padded to two
digits and `<basename>` is the URL's last path segment, `decodeURIComponent`'d and
sanitized with `[^A-Za-z0-9._-] → _`. The index guarantees uniqueness when two assets
share a name; the sanitization is what makes traversal impossible (`..%2F..%2Fetc` becomes
`.._.._etc`), and it is applied to the derived segment only — the directory always comes
from `assetsDir`. An empty or dot-only segment degrades to `asset`. If the sanitized
basename has no extension, one is appended from the content type:

| content type | ext |
|---|---|
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |
| `application/pdf` | `.pdf` |
| `text/plain` | `.txt` |
| anything else | `.bin` |

### `src/server/launchContext.ts`

```ts
export interface LaunchContext {
  …
  assets?: TicketAsset[];
  attachments?: TicketAttachment[];
}
```

Both optional and omitted when empty, following `rejectReason`. That keeps the context
file of an asset-less ticket byte-identical to today's and leaves the conflict session's
context untouched.

### `src/server/launch.ts`

`LaunchRequest` gains the same two optional fields, passed straight through to
`writeLaunchContext`. `launchConflictSession`, `launchCustomSession` and
`launchShellSession` are untouched.

### Routes

`POST /api/sessions` (ticket branch) and the verdict route's `launchRework` both become:

```ts
const id = tmuxName(ticket, status);
let content = { description: "", attachments: [] };
try { content = await getIssueContent(cfg.linearApiKey, ticket); } catch { /* launch anyway */ }
const prepared = await prepareTicketAssets({ stateDir: cfg.stateDir, id, ...content,
  download: (url) => downloadLinearAsset(cfg.linearApiKey, url) });
```

`prepareTicketAssets` never rejects, so no second `try` is needed around it. The verdict
route's `launchConflictFix` keeps using the description alone.

`POST /api/sessions` computes `id` with `tmuxName`, which validates the ticket and throws
on garbage; the call is guarded so a malformed ticket still returns 422 rather than 500.

### `src/server/prompts/work.ts`

One paragraph after the context-file sentence:

> The context may also carry `assets` (each `{url, localPath}`) and `attachments` (each
> `{title, url, localPath?}`). Read every `localPath` with the Read tool before you
> design — Mojito already downloaded those files for you, and they are part of the
> ticket. An attachment with no `localPath` is a plain link, informational only.

`conflict.ts` is unchanged.

## Error handling

Nothing in this path can stop a launch.

| failure | result |
|---|---|
| `getIssueContent` throws | empty description, no assets — today's behaviour |
| one asset 404s / times out / exceeds 10 MB | that asset is skipped; its URL still stands in the description text |
| an attachment is not downloadable | entry kept with `title` + `url`, no `localPath` |
| more than 20 assets | first 20 in work-list order; the rest keep their URLs in the text |
| relaunch under the same id | the asset directory is cleared first |

## Testing

| unit | cases |
|---|---|
| `extractAssetUrls` | markdown image, markdown link, bare URL, duplicates collapsed, order preserved, trailing punctuation trimmed, non-Linear host ignored, `uploads.linear.app.evil.com` rejected, empty description |
| `downloadLinearAsset` | `Authorization` header asserted, 200 → bytes + normalized content type, 404 throws, oversized `content-length` throws without buffering, oversized body throws, content type parameters stripped |
| `prepareTicketAssets` | happy path writes files and returns paths, one failing download does not sink the others, cap at `MAX_ASSETS`, colliding basenames get distinct files, traversal-shaped segment is sanitized, extension derived from content type, stale directory cleared on rerun, attachments split into downloaded and link-only, empty input → empty arrays |
| `writeLaunchContext` | round-trips `assets`/`attachments`, omits them when absent |
| `launchSession` | forwards both fields into the context file |
| `buildWorkPrompt` | mentions `localPath` and the Read instruction |
| `POST /api/sessions` | wiring: content fetched, assets prepared, both reach the context file; a Linear failure still launches |

`npx tsc --noEmit && npx vitest run` stays the gate.
