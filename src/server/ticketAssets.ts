import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ASSETS = 20;
// Downloads run sequentially and a launch is something the user is waiting on, not a
// batch job — so the whole step gets one deadline rather than letting worst case (20
// assets x their own 15 s timeout) hang the launch button for five minutes.
export const ASSET_BUDGET_MS = 30_000;

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  // Injectable clock so tests can drive the ASSET_BUDGET_MS deadline without real time.
  now?: () => number;
}

export interface PreparedTicketAssets {
  assets: TicketAsset[];
  attachments: TicketAttachment[];
}

/**
 * Put every Linear upload a ticket carries on disk and name the local paths, so the work
 * session — whose Read tool can't reach URLs that sit behind Linear's file auth — can Read them.
 *
 * Best-effort by construction: this never rejects. A single unreachable asset costs only
 * itself (its URL still stands in the description text), a state directory that cannot
 * be written costs only the assets, and a malformed input (e.g. a non-string
 * description) costs only the assets too — the launch proceeds either way. The outer
 * try/catch is what makes that a structural guarantee rather than something review has
 * to keep re-checking every time this function changes.
 */
export async function prepareTicketAssets(
  input: PrepareTicketAssetsInput,
): Promise<PreparedTicketAssets> {
  try {
    const now = input.now ?? Date.now;
    const start = now();

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
    } catch (err) {
      console.warn(`ticketAssets: could not prepare asset directory ${dir}: ${errorMessage(err)}`);
      return { assets: [], attachments };
    }

    const assets: TicketAsset[] = [];
    for (const [i, job] of jobs.entries()) {
      // One deadline for the whole step: a launch is something the user is waiting on
      // (often from a phone over Tailscale), not a batch job, so a slow or hanging asset
      // must not stack its 15 s timeout on top of nineteen others. Assets already
      // downloaded keep their entries; the rest are simply not there, exactly like any
      // other skipped asset.
      if (now() - start >= ASSET_BUDGET_MS) break;
      try {
        const { bytes, contentType } = await input.download(job.url);
        const localPath = join(dir, assetFilename(job.url, i + 1, contentType));
        writeFileSync(localPath, bytes, { mode: 0o600 });
        if (job.attachmentIndex === null) assets.push({ url: job.url, localPath });
        else attachments[job.attachmentIndex].localPath = localPath;
      } catch (err) {
        console.warn(`ticketAssets: could not download asset ${job.url}: ${errorMessage(err)}`);
      }
    }
    return { assets, attachments };
  } catch (err) {
    console.warn(`ticketAssets: prepareTicketAssets failed unexpectedly: ${errorMessage(err)}`);
    return { assets: [], attachments: [] };
  }
}
