import { LINEAR_TIMEOUT_MS } from "../linear/client";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const isImageType = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);

/**
 * The New-ticket sheet's images, checked as a whole before any of them reaches Linear: a
 * refusal must never leave half the set uploaded.
 */
export function validateImages(files: { name: string; type: string; size: number }[]): { ok: true } | { ok: false; error: string } {
  if (files.length > MAX_IMAGES) return { ok: false, error: `too many images (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!isImageType(f.type)) return { ok: false, error: `unsupported type: ${f.type}` };
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `image too large: ${f.name}` };
  }
  return { ok: true };
}

/**
 * Downloads an image Mojito uploaded to Linear, so the model can see it. Those urls sit behind
 * Linear's file auth, hence the API key — which stays in this process, never in the agent's.
 */
export function linearImageFetcher(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (url: string): Promise<{ mediaType: string; base64: string }> => {
    // Bounded like every other request to Linear (LINEAR_TIMEOUT_MS): a hung download would
    // otherwise hold one of the task queue's two slots for good.
    const res = await fetchImpl(url, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`image download failed: ${res.status}`);
    const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    return { mediaType, base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  };
}
