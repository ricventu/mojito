/**
 * Files into a session terminal: images and PDFs. claude's own image paste reads the clipboard
 * of the machine it runs on, never the browser's, and a pty carries only bytes — so the files
 * are uploaded to the server, and their absolute paths pasted into claude, which turns an image
 * into an `[Image #N]` attachment and reads a PDF.
 */
import { apiFetch } from "@/lib/api";
import { hostApi } from "@/lib/host";
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES } from "@/lib/images";

/** For the picker. The exact image types, not image/*: iOS then hands a HEIC photo over as a JPEG. */
export const ATTACHMENT_ACCEPT = [...IMAGE_TYPES, "application/pdf", ".pdf"].join(",");

/** `File.type` alone is not enough: a browser may hand a document over with none. */
const isPdf = (f: { name: string; type: string }): boolean => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/**
 * What a session accepts, with the server's limits and messages (`sessions/images.ts`). Separate
 * from `validateImages`, which guards what reaches Linear.
 */
export function validateAttachments(
  files: { name: string; type: string; size: number }[],
): { ok: true } | { ok: false; error: string } {
  if (files.length > MAX_IMAGES) return { ok: false, error: `too many files (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type) && !isPdf(f)) {
      return { ok: false, error: `unsupported file: ${f.name} (images and PDF only)` };
    }
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `file too large: ${f.name}` };
  }
  return { ok: true };
}

/**
 * The files a paste brings, or none when it carries text: then it is a text paste, so copying
 * spreadsheet cells or a Word paragraph (text plus a picture of it) pastes the words alone. A copy
 * from the Finder arrives as the file with no text (Chrome, verified). Every file counts, so one
 * the server refuses is refused with a reason, not ignored.
 */
export function pastedAttachments(data: { files: ArrayLike<File>; getData(type: string): string }): File[] {
  return data.getData("text/plain") ? [] : Array.from(data.files);
}

/** Uploads the files, then pastes their paths at claude's input line; nothing is pasted when either step refuses. */
export async function attachFiles(
  files: File[],
  io: { upload(files: File[]): Promise<string[]>; paste(text: string): void },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = validateAttachments(files);
  if (!check.ok) return check;
  let paths: string[];
  try {
    paths = await io.upload(files);
  } catch (err) {
    // A TypeError is fetch getting no answer, in words of its own ("Load failed" in Safari).
    if (err instanceof TypeError) return { ok: false, error: "upload failed: the connection dropped" };
    return { ok: false, error: err instanceof Error ? err.message : "upload failed" };
  }
  // The trailing space ends the last path, so what is typed next is not read as part of it.
  io.paste(`${paths.join(" ")} `);
  return { ok: true };
}

/**
 * `POST /api/sessions/:id/images`: the files' absolute paths on the server (a peer's, through the
 * relay). The route keeps its name so an older peer still takes images, and refuses a PDF in its
 * own words, which reach the user.
 */
export async function uploadAttachments(host: string | null, sessionId: string, files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of files) form.append("images", f);
  const { paths } = await apiFetch<{ paths: string[] }>(
    hostApi(host, `/api/sessions/${encodeURIComponent(sessionId)}/images`),
    { method: "POST", body: form },
  );
  return paths;
}
