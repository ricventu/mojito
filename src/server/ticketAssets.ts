import { rmSync, mkdirSync, writeFileSync } from "node:fs";
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
