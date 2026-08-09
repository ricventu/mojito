# Ticket images and attachments (RIC-177) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mojito downloads a ticket's Linear uploads at launch and names the local paths in the session context, so a work session that holds no Linear credential can still open the ticket's images and attachments.

**Architecture:** Linear I/O stays in the route layer. One GraphQL round trip (`getIssueContent`) brings back the description plus the attachment list; a new `ticketAssets` module extracts every `uploads.linear.app` URL, downloads the bytes through an injected `download` callback, and writes them under `<stateDir>/context/<id>-assets/`. The resulting `assets`/`attachments` arrays ride into `LaunchRequest` and out into the context JSON. `launch.ts` learns nothing about Linear.

**Tech Stack:** TypeScript, Next.js route handlers, Node `fs`, Vitest. No new dependencies.

Spec: `docs/superpowers/specs/2026-08-09-ticket-assets-design.md`.

## Global Constraints

- **English only** in every code artifact: identifiers, comments, log/error strings, commit messages, file names, docs.
- **The gate is `npx tsc --noEmit && npx vitest run`.** Both must pass before every commit. Baseline at the start of this branch: 606 tests, 0 failures.
- Server logic lives in `src/server/`, its tests in `tests/server/`. Import through the `@/` alias.
- **Spawned sessions never touch Linear.** Nothing in this plan may pass a Linear credential, tool, or URL-with-token to a session. The session only ever sees local file paths and plain URLs.
- **A launch must never fail because of an asset.** Every new call on the launch path is best-effort: it either degrades to empty or is wrapped so it cannot reject.
- State files stay owner-only: directories `0o700`, files `0o600`.
- **No test touches the network.** `linear.ts` functions take an injectable `fetchImpl`; `prepareTicketAssets` takes an injectable `download`.
- Limits, defined once in `src/server/ticketAssets.ts`: `MAX_ASSET_BYTES = 10 * 1024 * 1024`, `MAX_ASSETS = 20`. Download timeout `ASSET_TIMEOUT_MS = 15_000`, defined in `src/server/linear.ts`.

---

### Task 1: `getIssueContent` replaces `getIssueDescription`

Both existing callers already wanted the description; one of them now also wants the attachments. One round trip replaces what would otherwise be two, so this is a replacement, not a second function beside the first.

**Files:**
- Modify: `src/server/linear.ts:105-126` (replace `getIssueDescription`)
- Modify: `src/app/api/sessions/route.ts:5,46`
- Modify: `src/app/api/tickets/[id]/verdict/route.ts:4,48-50`
- Test: `tests/server/linear.test.ts:2,177-189`
- Test: `tests/server/verdictRoute.test.ts:8,20-23,63,247`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface IssueAttachmentRef { title: string; url: string }
  export interface IssueContent { description: string; attachments: IssueAttachmentRef[] }
  export function getIssueContent(
    apiKey: string, identifier: string, fetchImpl?: typeof fetch,
  ): Promise<IssueContent>
  ```

- [ ] **Step 1: Write the failing tests**

In `tests/server/linear.test.ts`, replace the whole `describe("getIssueDescription", …)` block (lines 177-189) with:

```ts
describe("getIssueContent", () => {
  it("returns the description and the attachment list", async () => {
    const impl = fakeFetch({ issues: { nodes: [{
      description: "the body",
      attachments: { nodes: [{ title: "Design", url: "https://figma.com/x" }] },
    }] } });
    expect(await getIssueContent("key", "RIC-46", impl)).toEqual({
      description: "the body",
      attachments: [{ title: "Design", url: "https://figma.com/x" }],
    });
  });

  it("degrades a null description and a missing attachment connection to empty", async () => {
    const impl = fakeFetch({ issues: { nodes: [{ description: null }] } });
    expect(await getIssueContent("key", "RIC-46", impl)).toEqual({ description: "", attachments: [] });
  });

  it("drops attachments with no url and defaults a missing title", async () => {
    const impl = fakeFetch({ issues: { nodes: [{
      description: "",
      attachments: { nodes: [{ title: "no url" }, { url: "https://example.com/a" }] },
    }] } });
    expect((await getIssueContent("key", "RIC-46", impl)).attachments)
      .toEqual([{ title: "", url: "https://example.com/a" }]);
  });

  it("throws when the issue does not exist", async () => {
    const impl = fakeFetch({ issues: { nodes: [] } });
    await expect(getIssueContent("key", "RIC-999", impl)).rejects.toThrow("issue not found");
  });

  it("asks for the attachments in the same query as the description", async () => {
    const impl = fakeFetch({ issues: { nodes: [{ description: "" }] } });
    await getIssueContent("key", "RIC-46", impl);
    const body = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
    expect(body).toContain("description");
    expect(body).toContain("attachments(first: 25)");
  });
});
```

Change the import on line 2 of that file: drop `getIssueDescription`, add `getIssueContent`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: FAIL — `getIssueContent` is not exported from `@/server/linear`.

- [ ] **Step 3: Implement `getIssueContent`**

In `src/server/linear.ts`, delete `getIssueDescription` (lines 105-126) and put this in its place:

```ts
export interface IssueAttachmentRef {
  title: string;
  url: string;
}

export interface IssueContent {
  description: string;
  attachments: IssueAttachmentRef[];
}

/**
 * The description plus the issue's attachment list in one round trip. Every caller on
 * the launch path wants both — the description for the prompt context, the attachments
 * so Mojito can download the ones that are Linear uploads.
 */
export async function getIssueContent(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueContent> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{
    issues: {
      nodes: {
        description?: string | null;
        attachments?: { nodes?: { title?: string | null; url?: string | null }[] };
      }[];
    };
  }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes {
            description
            attachments(first: 25) { nodes { title url } }
          }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node) throw new Error(`issue not found: ${identifier}`);
  const attachments: IssueAttachmentRef[] = [];
  for (const a of node.attachments?.nodes ?? []) {
    if (typeof a?.url === "string" && a.url) attachments.push({ title: a.title ?? "", url: a.url });
  }
  return { description: node.description ?? "", attachments };
}
```

- [ ] **Step 4: Update the two call sites**

`src/app/api/sessions/route.ts` — line 5 becomes:

```ts
import { getIssueContent, setIssueStatus } from "@/server/linear";
```

and line 46 becomes:

```ts
  try { description = (await getIssueContent(cfg.linearApiKey, body.ticket)).description; } catch { /* launch anyway with empty description */ }
```

`src/app/api/tickets/[id]/verdict/route.ts` — line 4 becomes:

```ts
import { getIssueStatus, setIssueStatus, getIssueContent } from "@/server/linear";
```

and the `describe` helper (lines 48-50) becomes:

```ts
  const describe = async () => {
    try { return (await getIssueContent(cfg.linearApiKey, id)).description; } catch { return ""; }
  };
```

- [ ] **Step 5: Update the verdict route test's mock**

In `tests/server/verdictRoute.test.ts`, rename the hoisted spy and its wiring:

```ts
// line 8, inside vi.hoisted
  getIssueContent: vi.fn(async () => ({ description: "the ticket description", attachments: [] })),
```

```ts
// lines 20-23
vi.mock("@/server/linear", () => ({
  getIssueStatus: h.getIssueStatus, setIssueStatus: h.setIssueStatus,
  getIssueContent: h.getIssueContent,
}));
```

```ts
// line 63, inside beforeEach
  h.getIssueContent.mockImplementation(async () => ({ description: "the ticket description", attachments: [] }));
```

```ts
// line 247
    h.getIssueContent.mockImplementation(async () => { throw new Error("Linear down"); });
```

- [ ] **Step 6: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. No occurrence of `getIssueDescription` is left — confirm with `grep -rn "getIssueDescription" src/ tests/` returning nothing.

- [ ] **Step 7: Commit**

```bash
git add src/server/linear.ts src/app/api/sessions/route.ts "src/app/api/tickets/[id]/verdict/route.ts" tests/server/linear.test.ts tests/server/verdictRoute.test.ts
git commit -m "refactor(linear): getIssueContent returns description and attachments in one query"
```

---

### Task 2: `downloadLinearAsset`

**Files:**
- Modify: `src/server/linear.ts` (append after `getIssueContent`)
- Test: `tests/server/linear.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing from Task 1 beyond the file it edits.
- Produces:
  ```ts
  export function downloadLinearAsset(
    apiKey: string, url: string, maxBytes: number, fetchImpl?: typeof fetch,
  ): Promise<{ bytes: Buffer; contentType: string }>
  ```
  `maxBytes` is a parameter, not a constant, so the asset-size policy stays in `ticketAssets.ts` and `linear.ts` stays a transport module.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/linear.test.ts`:

```ts
function fakeAssetFetch(opts: {
  ok?: boolean; status?: number; body?: Uint8Array; headers?: Record<string, string>;
}) {
  const headers = new Headers(opts.headers ?? {});
  const body = opts.body ?? new Uint8Array();
  return vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    arrayBuffer: async () => body.buffer,
  })) as unknown as typeof fetch;
}

describe("downloadLinearAsset", () => {
  it("sends the API key and returns the bytes with a normalized content type", async () => {
    const f = fakeAssetFetch({
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "image/png; charset=binary", "content-length": "3" },
    });
    const got = await downloadLinearAsset("k", "https://uploads.linear.app/a/b/c.png", 1000, f);
    expect(got.contentType).toBe("image/png");
    expect([...got.bytes]).toEqual([1, 2, 3]);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("k");
  });

  it("throws on a non-2xx response", async () => {
    const f = fakeAssetFetch({ ok: false, status: 404 });
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("404");
  });

  it("rejects an oversized asset from content-length without reading the body", async () => {
    const f = fakeAssetFetch({ headers: { "content-length": "5000" } });
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("too large");
  });

  it("rejects an oversized body even when content-length lies", async () => {
    const f = fakeAssetFetch({ body: new Uint8Array(2000), headers: { "content-length": "1" } });
    await expect(downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f))
      .rejects.toThrow("too large");
  });

  it("degrades a missing content-type to an empty string", async () => {
    const f = fakeAssetFetch({ body: new Uint8Array([9]) });
    expect((await downloadLinearAsset("k", "https://uploads.linear.app/x", 1000, f)).contentType).toBe("");
  });
});
```

Add `downloadLinearAsset` to the import on line 2.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/linear.test.ts`
Expected: FAIL — `downloadLinearAsset` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/server/linear.ts`:

```ts
const ASSET_TIMEOUT_MS = 15_000;

/**
 * Fetch one `uploads.linear.app` asset. Linear serves these only to a request carrying
 * the API key, and a spawned session never has one — so Mojito pulls the bytes at launch
 * instead. Redirects are followed to the signed storage URL; `fetch` drops the
 * Authorization header on that cross-origin hop, which is correct: the target is
 * pre-signed. Size is checked twice because `content-length` is advisory — the header
 * check is what keeps an oversized asset from ever being buffered.
 */
export async function downloadLinearAsset(
  apiKey: string,
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchImpl(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Linear asset download failed: ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Linear asset too large: ${declared} bytes`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Linear asset too large: ${bytes.length} bytes`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return { bytes, contentType };
}
```

- [ ] **Step 4: Run the gate**

Run: `npx tsc --noEmit && npx vitest run tests/server/linear.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/linear.ts tests/server/linear.test.ts
git commit -m "feat(linear): download a Linear upload with the API key"
```

---

### Task 3: `ticketAssets` — URL extraction and on-disk naming

Pure helpers plus the two directory functions. No network, no orchestration yet.

**Files:**
- Create: `src/server/ticketAssets.ts`
- Test: `tests/server/ticketAssets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const MAX_ASSET_BYTES: number   // 10 * 1024 * 1024
  export const MAX_ASSETS: number        // 20
  export function isLinearUploadUrl(url: string): boolean
  export function extractAssetUrls(description: string): string[]
  export function assetFilename(url: string, index: number, contentType: string): string
  export function assetsDir(stateDir: string, id: string): string
  export function clearTicketAssets(stateDir: string, id: string): void
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/server/ticketAssets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAssetUrls, isLinearUploadUrl, assetFilename, assetsDir, clearTicketAssets,
} from "@/server/ticketAssets";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("isLinearUploadUrl", () => {
  it("accepts a Linear upload URL", () => {
    expect(isLinearUploadUrl("https://uploads.linear.app/a/b/c.png")).toBe(true);
  });

  it("rejects a lookalike host", () => {
    expect(isLinearUploadUrl("https://uploads.linear.app.evil.com/a.png")).toBe(false);
  });

  it("rejects an unrelated host", () => {
    expect(isLinearUploadUrl("https://github.com/x/y/pull/1")).toBe(false);
  });
});

describe("extractAssetUrls", () => {
  it("finds a markdown image, a markdown link, and a bare URL", () => {
    const urls = extractAssetUrls([
      "![shot](https://uploads.linear.app/w/a/one.png)",
      "[the log](https://uploads.linear.app/w/b/two.txt)",
      "see https://uploads.linear.app/w/c/three.pdf for the rest",
    ].join("\n"));
    expect(urls).toEqual([
      "https://uploads.linear.app/w/a/one.png",
      "https://uploads.linear.app/w/b/two.txt",
      "https://uploads.linear.app/w/c/three.pdf",
    ]);
  });

  it("collapses duplicates and keeps first-appearance order", () => {
    const urls = extractAssetUrls(
      "![](https://uploads.linear.app/b.png) ![](https://uploads.linear.app/a.png) ![](https://uploads.linear.app/b.png)",
    );
    expect(urls).toEqual(["https://uploads.linear.app/b.png", "https://uploads.linear.app/a.png"]);
  });

  it("trims trailing sentence punctuation", () => {
    expect(extractAssetUrls("look at https://uploads.linear.app/w/a.png."))
      .toEqual(["https://uploads.linear.app/w/a.png"]);
  });

  it("ignores non-Linear hosts and the bare host with no path", () => {
    expect(extractAssetUrls("https://example.com/a.png and https://uploads.linear.app/")).toEqual([]);
  });

  it("returns nothing for an empty description", () => {
    expect(extractAssetUrls("")).toEqual([]);
  });
});

describe("assetFilename", () => {
  it("indexes and keeps a clean basename", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/shot.png", 1, "image/png")).toBe("01-shot.png");
  });

  it("indexes past nine without losing order", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/shot.png", 12, "image/png")).toBe("12-shot.png");
  });

  it("appends an extension derived from the content type when the URL has none", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/abcdef", 2, "application/pdf")).toBe("02-abcdef.pdf");
  });

  it("falls back to .bin for an unknown content type", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/abcdef", 3, "application/zip")).toBe("03-abcdef.bin");
  });

  it("sanitizes a traversal-shaped segment into a flat name", () => {
    const name = assetFilename("https://uploads.linear.app/w/..%2F..%2Fetc%2Fpasswd", 1, "image/png");
    expect(name).toBe("01-.._.._etc_passwd");
    expect(name).not.toContain("/");
  });

  it("degrades an empty or dot-only segment to 'asset'", () => {
    expect(assetFilename("https://uploads.linear.app/w/", 1, "image/png")).toBe("01-asset.png");
    expect(assetFilename("https://uploads.linear.app/w/..", 1, "image/png")).toBe("01-asset.png");
  });

  it("gives colliding basenames distinct filenames", () => {
    const a = assetFilename("https://uploads.linear.app/w/x/shot.png", 1, "image/png");
    const b = assetFilename("https://uploads.linear.app/w/y/shot.png", 2, "image/png");
    expect(a).not.toBe(b);
  });
});

describe("assetsDir / clearTicketAssets", () => {
  it("sits beside the context file", () => {
    expect(assetsDir("/state", "mojito-RIC-46-work")).toBe(join("/state", "context", "mojito-RIC-46-work-assets"));
  });

  it("removes a previous run's files", () => {
    const d = assetsDir(dir, "mojito-RIC-46-work");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "01-old.png"), "stale");
    clearTicketAssets(dir, "mojito-RIC-46-work");
    expect(existsSync(d)).toBe(false);
  });

  it("is a no-op when the directory never existed", () => {
    expect(() => clearTicketAssets(dir, "mojito-RIC-99-work")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/ticketAssets.test.ts`
Expected: FAIL — cannot resolve `@/server/ticketAssets`.

- [ ] **Step 3: Implement the module**

Create `src/server/ticketAssets.ts`:

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";

export const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ASSETS = 20;

const UPLOAD_PREFIX = "https://uploads.linear.app/";

// Stops at whitespace and at the characters that close a markdown link, an HTML
// attribute, or an inline code span. The mandatory "/" after the host is what keeps
// https://uploads.linear.app.evil.com/x from matching.
const ASSET_URL_RE = /https:\/\/uploads\.linear\.app\/[^\s)\]"'<>`]+/g;

const EXT_BY_CONTENT_TYPE = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
]);

export function isLinearUploadUrl(url: string): boolean {
  return url.startsWith(UPLOAD_PREFIX);
}

/**
 * Every Linear upload referenced by a description, unique and in order of first
 * appearance. Covers markdown images, markdown links, and bare URLs alike — Linear
 * writes all three, and Mojito's own New Ticket form appends the image form.
 */
export function extractAssetUrls(description: string): string[] {
  const urls = new Set<string>(); // insertion-ordered: first appearance wins
  for (const m of description.matchAll(ASSET_URL_RE)) {
    // A URL genuinely ending in sentence punctuation is far less likely than a
    // sentence that ends after one.
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (url.length > UPLOAD_PREFIX.length) urls.add(url);
  }
  return [...urls];
}

/**
 * A filename that cannot escape the asset directory: the URL's last path segment,
 * stripped of everything outside [A-Za-z0-9._-], prefixed with its 1-based index so two
 * assets sharing a basename still get two files.
 */
export function assetFilename(url: string, index: number, contentType: string): string {
  let segment = "";
  try {
    segment = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    segment = ""; // malformed URL or bad percent-encoding — the index still names it
  }
  let base = segment.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!base || /^\.+$/.test(base)) base = "asset";
  if (!/\.[A-Za-z0-9]+$/.test(base)) base += EXT_BY_CONTENT_TYPE.get(contentType) ?? ".bin";
  return `${String(index).padStart(2, "0")}-${base}`;
}

export function assetsDir(stateDir: string, id: string): string {
  return join(stateDir, "context", `${id}-assets`);
}

/**
 * Drop a previous run's assets. Session ids repeat — a QA rework relaunches under the
 * same `mojito-<ticket>-work` id — so without this a rework inherits stale files. Same
 * reasoning as clearSessionResult.
 */
export function clearTicketAssets(stateDir: string, id: string): void {
  rmSync(assetsDir(stateDir, id), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/ticketAssets.test.ts`
Expected: PASS (all 17 tests in the file).

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ticketAssets.ts tests/server/ticketAssets.test.ts
git commit -m "feat(assets): extract Linear upload URLs and derive safe local filenames"
```

---

### Task 4: `prepareTicketAssets`

**Files:**
- Modify: `src/server/ticketAssets.ts` (append)
- Test: `tests/server/ticketAssets.test.ts` (append)

**Interfaces:**
- Consumes: `extractAssetUrls`, `isLinearUploadUrl`, `assetFilename`, `assetsDir`, `clearTicketAssets`, `MAX_ASSETS` from Task 3.
- Produces:
  ```ts
  export interface TicketAsset { url: string; localPath: string }
  export interface TicketAttachment { title: string; url: string; localPath?: string }
  export interface PrepareTicketAssetsInput {
    stateDir: string;
    id: string;
    description: string;
    attachments: { title: string; url: string }[];
    download: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
  }
  export interface PreparedTicketAssets {
    assets: TicketAsset[];
    attachments: TicketAttachment[];
  }
  export function prepareTicketAssets(
    input: PrepareTicketAssetsInput,
  ): Promise<PreparedTicketAssets>
  ```

- [ ] **Step 1: Write the failing tests**

First replace the two import lines at the top of `tests/server/ticketAssets.test.ts` with:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
```

```ts
import {
  extractAssetUrls, isLinearUploadUrl, assetFilename, assetsDir, clearTicketAssets,
  prepareTicketAssets, MAX_ASSETS,
} from "@/server/ticketAssets";
```

Then append:

```ts
const png = (n: number) => ({ bytes: Buffer.from([n]), contentType: "image/png" });

describe("prepareTicketAssets", () => {
  it("downloads every description upload and returns url + local path", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "mojito-RIC-46-work",
      description: "![](https://uploads.linear.app/w/a/one.png) ![](https://uploads.linear.app/w/b/two.png)",
      attachments: [],
      download: async (url) => png(url.includes("one") ? 1 : 2),
    });
    expect(got.assets.map((a) => a.url)).toEqual([
      "https://uploads.linear.app/w/a/one.png",
      "https://uploads.linear.app/w/b/two.png",
    ]);
    expect(readFileSync(got.assets[0].localPath)).toEqual(Buffer.from([1]));
    expect(readFileSync(got.assets[1].localPath)).toEqual(Buffer.from([2]));
    expect(got.assets[0].localPath.startsWith(assetsDir(dir, "mojito-RIC-46-work"))).toBe(true);
  });

  it("writes the assets owner-only", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [], download: async () => png(1),
    });
    expect(statSync(got.assets[0].localPath).mode & 0o777).toBe(0o600);
  });

  it("keeps going when one download fails", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/bad.png) ![](https://uploads.linear.app/w/b/good.png)",
      attachments: [],
      download: async (url) => {
        if (url.includes("bad")) throw new Error("404");
        return png(7);
      },
    });
    expect(got.assets).toHaveLength(1);
    expect(got.assets[0].url).toContain("good.png");
  });

  it("downloads Linear attachments and leaves plain links as URLs", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "",
      attachments: [
        { title: "Spec", url: "https://uploads.linear.app/w/a/spec.pdf" },
        { title: "The PR", url: "https://github.com/x/y/pull/1" },
      ],
      download: async () => ({ bytes: Buffer.from([5]), contentType: "application/pdf" }),
    });
    expect(got.assets).toEqual([]);
    expect(got.attachments[0].title).toBe("Spec");
    expect(got.attachments[0].localPath).toMatch(/spec\.pdf$/);
    expect(got.attachments[1]).toEqual({ title: "The PR", url: "https://github.com/x/y/pull/1" });
  });

  it("caps the work list at MAX_ASSETS, description uploads first", async () => {
    const description = Array.from({ length: MAX_ASSETS + 5 },
      (_, i) => `![](https://uploads.linear.app/w/${i}/a.png)`).join(" ");
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description,
      attachments: [{ title: "Late", url: "https://uploads.linear.app/w/late/z.png" }],
      download: async () => png(1),
    });
    expect(got.assets).toHaveLength(MAX_ASSETS);
    expect(got.attachments[0].localPath).toBeUndefined();
  });

  it("gives colliding basenames two distinct files on disk", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/shot.png) ![](https://uploads.linear.app/w/b/shot.png)",
      attachments: [], download: async () => png(1),
    });
    expect(got.assets[0].localPath).not.toBe(got.assets[1].localPath);
    expect(readdirSync(assetsDir(dir, "s"))).toHaveLength(2);
  });

  it("clears a previous run's assets before downloading", async () => {
    const d = assetsDir(dir, "s");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "99-stale.png"), "stale");
    await prepareTicketAssets({
      stateDir: dir, id: "s", description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [], download: async () => png(1),
    });
    expect(readdirSync(d)).toEqual(["01-one.png"]);
  });

  it("returns empty arrays and creates no directory when there is nothing to fetch", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "no images here", attachments: [],
      download: async () => { throw new Error("must not be called"); },
    });
    expect(got).toEqual({ assets: [], attachments: [] });
    expect(existsSync(assetsDir(dir, "s"))).toBe(false);
  });

  it("never rejects when the state directory cannot be written", async () => {
    // A plain file where the `context` directory belongs: mkdirSync then fails ENOTDIR.
    writeFileSync(join(dir, "context"), "not a directory");
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
      download: async () => png(1),
    });
    expect(got.assets).toEqual([]);
    expect(got.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });
});
```

Also extend the `vitest`/`node:fs` imports at the top of the file so `statSync`, `readFileSync`, `readdirSync` and `MAX_ASSETS` are in scope.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/ticketAssets.test.ts`
Expected: FAIL — `prepareTicketAssets` is not exported.

- [ ] **Step 3: Implement it**

Append to `src/server/ticketAssets.ts` (and add `mkdirSync, writeFileSync` to the `node:fs` import):

```ts
export interface TicketAsset {
  url: string;
  localPath: string;
}

export interface TicketAttachment {
  title: string;
  url: string;
  localPath?: string;
}

export interface PrepareTicketAssetsInput {
  stateDir: string;
  id: string;
  description: string;
  attachments: { title: string; url: string }[];
  download: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
}

export interface PreparedTicketAssets {
  assets: TicketAsset[];
  attachments: TicketAttachment[];
}

/**
 * Put every Linear upload a ticket carries on disk and name the local paths, so the work
 * session — which holds no Linear credential — can Read them.
 *
 * Best-effort by construction: this never rejects. A single unreachable asset costs only
 * itself (its URL still stands in the description text), and a state directory that
 * cannot be written costs only the assets — the launch proceeds either way.
 */
export async function prepareTicketAssets(
  input: PrepareTicketAssetsInput,
): Promise<PreparedTicketAssets> {
  const attachments: TicketAttachment[] = input.attachments.map((a) => ({ title: a.title, url: a.url }));

  // Description uploads first: they are what a session most often needs, so they are the
  // ones that survive the cap.
  const jobs: { url: string; attachmentIndex: number | null }[] = [
    ...extractAssetUrls(input.description).map((url) => ({ url, attachmentIndex: null })),
    ...attachments.flatMap((a, i) => (isLinearUploadUrl(a.url) ? [{ url: a.url, attachmentIndex: i }] : [])),
  ].slice(0, MAX_ASSETS);

  if (jobs.length === 0) return { assets: [], attachments };

  const dir = assetsDir(input.stateDir, input.id);
  try {
    clearTicketAssets(input.stateDir, input.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return { assets: [], attachments };
  }

  const assets: TicketAsset[] = [];
  for (const [i, job] of jobs.entries()) {
    try {
      const { bytes, contentType } = await input.download(job.url);
      const localPath = join(dir, assetFilename(job.url, i + 1, contentType));
      writeFileSync(localPath, bytes, { mode: 0o600 });
      if (job.attachmentIndex === null) assets.push({ url: job.url, localPath });
      else attachments[job.attachmentIndex].localPath = localPath;
    } catch {
      // Best-effort: this asset is simply absent, and its URL still stands in the
      // description text or the attachment entry.
    }
  }
  return { assets, attachments };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/ticketAssets.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ticketAssets.ts tests/server/ticketAssets.test.ts
git commit -m "feat(assets): download a ticket's Linear uploads into the state dir"
```

---

### Task 5: Carry `assets` and `attachments` into the session context

**Files:**
- Modify: `src/server/launchContext.ts:4-12`
- Modify: `src/server/launch.ts:16-26,77-85`
- Test: `tests/server/launchContext.test.ts`
- Test: `tests/server/launch.test.ts`

**Interfaces:**
- Consumes: `TicketAsset`, `TicketAttachment` from Task 4.
- Produces: `LaunchContext.assets?`, `LaunchContext.attachments?`, `LaunchRequest.assets?`, `LaunchRequest.attachments?` — all optional, all omitted from the written JSON when empty or absent.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/launchContext.test.ts`:

```ts
describe("writeLaunchContext asset fields", () => {
  it("round-trips assets and attachments", () => {
    const withAssets: LaunchContext = {
      ...ctx,
      assets: [{ url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/s-assets/01-a.png" }],
      attachments: [
        { title: "Spec", url: "https://uploads.linear.app/w/s.pdf", localPath: "/state/context/s-assets/02-s.pdf" },
        { title: "The PR", url: "https://github.com/x/y/pull/1" },
      ],
    };
    const p = writeLaunchContext(dir, "mojito-RIC-46-work", withAssets);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(withAssets);
  });

  it("omits both fields when the ticket carries nothing", () => {
    const p = writeLaunchContext(dir, "mojito-RIC-46-work", ctx);
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect("assets" in written).toBe(false);
    expect("attachments" in written).toBe(false);
  });
});
```

Append to `tests/server/launch.test.ts`, inside the existing `describe("launchSession", …)`:

```ts
  it("forwards assets and attachments into the context file", async () => {
    const d = deps();
    await launchSession({
      ...baseReq,
      assets: [{ url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/x-assets/01-a.png" }],
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
    }, d);
    const written = JSON.parse(readFileSync(join(dir, "context", "mojito-RIC-46-planned.json"), "utf8"));
    expect(written.assets).toEqual([
      { url: "https://uploads.linear.app/w/a.png", localPath: "/state/context/x-assets/01-a.png" },
    ]);
    expect(written.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });

  it("omits the asset fields when the request carries none", async () => {
    const d = deps();
    await launchSession({ ...baseReq, assets: [], attachments: [] }, d);
    const written = JSON.parse(readFileSync(join(dir, "context", "mojito-RIC-46-planned.json"), "utf8"));
    expect("assets" in written).toBe(false);
    expect("attachments" in written).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/launchContext.test.ts tests/server/launch.test.ts`
Expected: FAIL — `assets` is not a known property of `LaunchContext`/`LaunchRequest`.

- [ ] **Step 3: Add the fields to `LaunchContext`**

In `src/server/launchContext.ts`, add the import and the two fields:

```ts
import type { TicketAsset, TicketAttachment } from "./ticketAssets.js";

export interface LaunchContext {
  identifier: string;
  statusName: string;
  title: string;
  project: string | null;
  labels: string[];
  description: string;
  // Linear uploads Mojito already downloaded for the session — it holds no Linear
  // credential of its own, so a bare URL would be unreadable to it. Omitted when empty.
  assets?: TicketAsset[];
  attachments?: TicketAttachment[];
  rejectReason?: string;
}
```

- [ ] **Step 4: Add the fields to `LaunchRequest` and forward them**

In `src/server/launch.ts`, add to the imports:

```ts
import type { TicketAsset, TicketAttachment } from "./ticketAssets.js";
```

Add to `LaunchRequest` (after `description`):

```ts
  assets?: TicketAsset[];
  attachments?: TicketAttachment[];
```

And in the `writeLaunchContext` call inside `launchSession`, insert before the `rejectReason` spread:

```ts
    ...(req.assets?.length ? { assets: req.assets } : {}),
    ...(req.attachments?.length ? { attachments: req.attachments } : {}),
```

`launchConflictSession`, `launchCustomSession` and `launchShellSession` are not touched.

- [ ] **Step 5: Run the gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/launchContext.ts src/server/launch.ts tests/server/launchContext.test.ts tests/server/launch.test.ts
git commit -m "feat(launch): carry downloaded ticket assets into the session context"
```

---

### Task 6: Tell the work session to read the files

**Files:**
- Modify: `src/server/prompts/work.ts:6-8`
- Test: `tests/server/prompts.test.ts`

**Interfaces:**
- Consumes: the context field names `assets`, `attachments`, `localPath` from Task 5.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to the `describe("prompt builder", …)` block in `tests/server/prompts.test.ts`:

```ts
  it("tells the work session to read the assets Mojito downloaded", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("localPath");
    expect(p).toContain("Read tool");
    expect(p).toContain("attachments");
  });

  it("leaves the conflict prompt free of the asset paragraph", () => {
    expect(buildConflictPrompt(vars)).not.toContain("localPath");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/prompts.test.ts`
Expected: FAIL — the work prompt does not contain "localPath".

- [ ] **Step 3: Add the paragraph**

In `src/server/prompts/work.ts`, insert this paragraph immediately after the sentence ending `Mojito manages Linear for you.` and before `Follow this sequence:`:

```
The context may also carry \`assets\` (each \`{url, localPath}\`) and \`attachments\`
(each \`{title, url, localPath?}\`). Read every \`localPath\` with the Read tool before
you design — Mojito already downloaded those files for you and they are part of the
ticket. An attachment with no \`localPath\` is a plain link, informational only.
```

The template is a JavaScript backtick string, so every backtick inside it must be escaped as `` \` `` exactly as shown.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/server/prompts.test.ts`
Expected: PASS, including the pre-existing `not.toContain("{{")` assertions.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts/work.ts tests/server/prompts.test.ts
git commit -m "feat(prompts): tell the work session to read the downloaded ticket assets"
```

---

### Task 7: Wire the launch path

**Files:**
- Modify: `src/app/api/sessions/route.ts:1-6,45-54`
- Modify: `src/app/api/tickets/[id]/verdict/route.ts:1-14,48-50,67-93`
- Create: `tests/server/sessionsRoute.test.ts`
- Test: `tests/server/verdictRoute.test.ts`

**Interfaces:**
- Consumes: `getIssueContent` + `downloadLinearAsset` (Tasks 1-2), `prepareTicketAssets` + `MAX_ASSET_BYTES` (Tasks 3-4), `LaunchRequest.assets`/`.attachments` (Task 5).
- Produces: nothing later tasks depend on — this is the last task.

- [ ] **Step 1: Write the failing route test**

Create `tests/server/sessionsRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  getIssueContent: vi.fn(async () => ({
    description: "![](https://uploads.linear.app/w/a/one.png)",
    attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
  })),
  downloadLinearAsset: vi.fn(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" })),
  // Mocked, not exercised: prepareTicketAssets has its own test file, and mocking it keeps
  // this one about wiring rather than about the filesystem.
  prepareTicketAssets: vi.fn(async (input: { description: string; attachments: { title: string; url: string }[] }) => ({
    assets: input.description
      ? [{ url: "https://uploads.linear.app/w/a/one.png", localPath: "/state/context/x-assets/01-one.png" }]
      : [],
    attachments: input.attachments,
  })),
  setIssueStatus: vi.fn(async () => {}),
  launchSession: vi.fn(async () => ({ ok: true, meta: { id: "mojito-RIC-46-work" } }) as
    { ok: boolean; reason?: string; meta?: unknown }),
  launchCustomSession: vi.fn(async () => ({ ok: true, meta: {} })),
  launchShellSession: vi.fn(async () => ({ ok: true, meta: {} })),
}));

vi.mock("@/server/linear", () => ({
  getIssueContent: h.getIssueContent, downloadLinearAsset: h.downloadLinearAsset,
  setIssueStatus: h.setIssueStatus,
}));
vi.mock("@/server/ticketAssets", () => ({
  prepareTicketAssets: h.prepareTicketAssets, MAX_ASSET_BYTES: 10 * 1024 * 1024,
}));
vi.mock("@/server/launch", () => ({
  launchSession: h.launchSession, launchCustomSession: h.launchCustomSession,
  launchShellSession: h.launchShellSession,
}));
vi.mock("@/server/tmux", () => ({
  hasSession: vi.fn(async () => false), newSession: vi.fn(async () => {}), pipePane: vi.fn(async () => {}),
}));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", linearApiKey: "k", stateDir: "/state", port: 4711,
    projectsPath: "/projects.json" }),
  getRegistry: () => ({ all: () => [] }),
}));

import { POST } from "@/app/api/sessions/route";

const TOKEN = "test-token";
function req(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const launch = { ticket: "RIC-46", status: "In Progress", projectName: "Mojito", title: "Some ticket" };

beforeEach(() => {
  vi.clearAllMocks();
  h.getIssueContent.mockImplementation(async () => ({
    description: "![](https://uploads.linear.app/w/a/one.png)",
    attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
  }));
  h.downloadLinearAsset.mockImplementation(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" }));
  h.prepareTicketAssets.mockImplementation(async (input) => ({
    assets: input.description
      ? [{ url: "https://uploads.linear.app/w/a/one.png", localPath: "/state/context/x-assets/01-one.png" }]
      : [],
    attachments: input.attachments,
  }));
  h.launchSession.mockImplementation(async () => ({ ok: true, meta: { id: "mojito-RIC-46-work" } }));
});

describe("POST /api/sessions (ticket)", () => {
  it("prepares the assets under the session's own id and hands them to launchSession", async () => {
    const res = await POST(req(launch));
    expect(res.status).toBe(201);
    const prep = h.prepareTicketAssets.mock.calls[0][0] as {
      id: string; stateDir: string; description: string; attachments: { title: string }[];
    };
    expect(prep.id).toBe("mojito-RIC-46-work"); // tmuxName collapses the work states
    expect(prep.stateDir).toBe("/state");
    expect(prep.description).toBe("![](https://uploads.linear.app/w/a/one.png)");
    const passed = h.launchSession.mock.calls[0][0] as {
      assets: { url: string }[]; attachments: { title: string; localPath?: string }[];
    };
    expect(passed.assets.map((a) => a.url)).toEqual(["https://uploads.linear.app/w/a/one.png"]);
    expect(passed.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });

  it("gives prepareTicketAssets a download bound to the Linear API key and the size cap", async () => {
    await POST(req(launch));
    const prep = h.prepareTicketAssets.mock.calls[0][0] as {
      download: (url: string) => Promise<unknown>;
    };
    await prep.download("https://uploads.linear.app/w/a/one.png");
    expect(h.downloadLinearAsset)
      .toHaveBeenCalledWith("k", "https://uploads.linear.app/w/a/one.png", 10 * 1024 * 1024);
  });

  it("launches with an empty description and no assets when Linear is down", async () => {
    h.getIssueContent.mockImplementation(async () => { throw new Error("Linear down"); });
    const res = await POST(req(launch));
    expect(res.status).toBe(201);
    const passed = h.launchSession.mock.calls[0][0] as { description: string; assets: unknown[] };
    expect(passed.description).toBe("");
    expect(passed.assets).toEqual([]);
  });

  it("rejects a malformed ticket id with 422 rather than a 500", async () => {
    const res = await POST(req({ ...launch, ticket: "not a ticket" }));
    expect(res.status).toBe(422);
    expect(h.launchSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/sessionsRoute.test.ts`
Expected: FAIL — `launchSession` is called without `assets`/`attachments`, and the malformed-ticket case returns 500.

- [ ] **Step 3: Wire `POST /api/sessions`**

In `src/app/api/sessions/route.ts`, extend the imports:

```ts
import { getIssueContent, downloadLinearAsset, setIssueStatus, type IssueContent } from "@/server/linear";
import { prepareTicketAssets, MAX_ASSET_BYTES } from "@/server/ticketAssets";
import { tmuxName } from "@/server/sessionKey";
```

Replace lines 45-54 (the `description` fetch and the `launchSession` call) with:

```ts
  // The session id has to be known before the launch, because the assets are written into
  // a directory named after it. tmuxName validates the ticket, so a malformed one is a 422
  // here rather than an unhandled throw inside launchSession.
  let id: string;
  try { id = tmuxName(body.ticket, body.status); } catch { return NextResponse.json({ error: "invalid ticket" }, { status: 422 }); }
  let content: IssueContent = { description: "", attachments: [] };
  try { content = await getIssueContent(cfg.linearApiKey, body.ticket); } catch { /* launch anyway with empty description */ }
  // Never rejects: an unreachable asset costs itself, not the launch.
  const prepared = await prepareTicketAssets({
    stateDir: cfg.stateDir, id, description: content.description, attachments: content.attachments,
    download: (url) => downloadLinearAsset(cfg.linearApiKey, url, MAX_ASSET_BYTES),
  });
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      description: content.description, assets: prepared.assets, attachments: prepared.attachments },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npx vitest run tests/server/sessionsRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing verdict-route test**

Append to the rework `describe` block in `tests/server/verdictRoute.test.ts`:

```ts
  it("hands the rework session the ticket's downloaded assets", async () => {
    h.getIssueContent.mockImplementation(async () => ({
      description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
    }));
    await POST(req({ arg: "reject", reason: "missed the edge case", projectName: "Mojito" }), params());
    const passed = h.launchSession.mock.calls[0][0] as {
      attachments: { title: string }[]; rejectReason: string;
    };
    expect(passed.rejectReason).toBe("missed the edge case");
    expect(passed.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });
```

Add `prepareTicketAssets` and `downloadLinearAsset` to the hoisted spies and the mocks:

```ts
// inside vi.hoisted
  downloadLinearAsset: vi.fn(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" })),
  prepareTicketAssets: vi.fn(async (input: { attachments: { title: string; url: string }[] }) =>
    ({ assets: [], attachments: input.attachments })),
```

```ts
vi.mock("@/server/linear", () => ({
  getIssueStatus: h.getIssueStatus, setIssueStatus: h.setIssueStatus,
  getIssueContent: h.getIssueContent, downloadLinearAsset: h.downloadLinearAsset,
}));
vi.mock("@/server/ticketAssets", () => ({
  prepareTicketAssets: h.prepareTicketAssets, MAX_ASSET_BYTES: 10 * 1024 * 1024,
}));
```

and reset `h.prepareTicketAssets` in `beforeEach` alongside the others.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/server/verdictRoute.test.ts`
Expected: FAIL — `launchSession` receives no `attachments`.

- [ ] **Step 7: Wire the verdict route**

In `src/app/api/tickets/[id]/verdict/route.ts`, extend the imports:

```ts
import { getIssueStatus, setIssueStatus, getIssueContent, downloadLinearAsset, type IssueContent } from "@/server/linear";
import { prepareTicketAssets, MAX_ASSET_BYTES } from "@/server/ticketAssets";
```

Replace the `describe` helper (lines 48-50) with:

```ts
  const content = async (): Promise<IssueContent> => {
    try { return await getIssueContent(cfg.linearApiKey, id); } catch { return { description: "", attachments: [] }; }
  };
```

In `launchRework`, replace the `launchSession` call so it prepares assets first (`sid` is already in scope):

```ts
            const c = await content();
            const prepared = await prepareTicketAssets({
              stateDir: cfg.stateDir, id: sid, description: c.description, attachments: c.attachments,
              download: (url) => downloadLinearAsset(cfg.linearApiKey, url, MAX_ASSET_BYTES),
            });
            const res = await launchSession(
              { ticket: id, status, model: defaultModelForStatus(status),
                effort: defaultEffortForStatus(status), projectName, title, labels: [],
                description: c.description, assets: prepared.assets, attachments: prepared.attachments,
                rejectReason },
              tmuxDeps,
            );
```

In `launchConflictFix`, replace `description: await describe()` with:

```ts
              { ticket: id, projectName, title, description: (await content()).description,
```

- [ ] **Step 8: Run the full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Confirm the count grew from the 606 baseline and that nothing regressed.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/sessions/route.ts "src/app/api/tickets/[id]/verdict/route.ts" tests/server/sessionsRoute.test.ts tests/server/verdictRoute.test.ts
git commit -m "feat(launch): download ticket assets on the session and rework launch paths"
```

---

## Verification

After Task 7, the whole feature is in. Confirm by hand:

- [ ] `npx tsc --noEmit && npx vitest run` — clean, test count above the 606 baseline.
- [ ] `grep -rn "getIssueDescription" src/ tests/` — no hits.
- [ ] `git diff main...HEAD --stat` — touches only `src/server/{linear,ticketAssets,launch,launchContext}.ts`, `src/server/prompts/work.ts`, the two route files, their tests, and the two docs.
