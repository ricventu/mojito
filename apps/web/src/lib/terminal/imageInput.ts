/**
 * Images into a session terminal. claude's own image paste reads the clipboard of the
 * machine it runs on, never the browser's, and a pty carries only bytes — so the images
 * are uploaded to the server, and their absolute paths pasted into claude, which turns
 * each into an `[Image #N]` attachment.
 */
import { apiFetch } from "@/lib/api";
import { validateImages } from "@/lib/images";

/** Uploads the images, then pastes their paths at claude's input line; nothing is pasted when either step refuses. */
export async function attachImages(
  files: File[],
  io: { upload(files: File[]): Promise<string[]>; paste(text: string): void },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = validateImages(files);
  if (!check.ok) return check;
  let paths: string[];
  try {
    paths = await io.upload(files);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "upload failed" };
  }
  // The trailing space ends the last path, so what is typed next is not read as part of it.
  io.paste(`${paths.join(" ")} `);
  return { ok: true };
}

/** `POST /api/sessions/:id/images`: the images' absolute paths on the server. */
export async function uploadImages(sessionId: string, files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of files) form.append("images", f);
  const { paths } = await apiFetch<{ paths: string[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/images`, {
    method: "POST",
    body: form,
  });
  return paths;
}
