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
  if (files.length > MAX_IMAGES) return { ok: false, error: `troppe immagini (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!isImageType(f.type)) return { ok: false, error: `tipo non supportato: ${f.type}` };
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `immagine troppo grande: ${f.name}` };
  }
  return { ok: true };
}

/**
 * Downloads an image Mojito uploaded to Linear, so the model can see it. Those urls sit behind
 * Linear's file auth, hence the API key — which stays in this process, never in the agent's.
 */
export function linearImageFetcher(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return async (url: string): Promise<{ mediaType: string; base64: string }> => {
    const res = await fetchImpl(url, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`download immagine fallito: ${res.status}`);
    const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    return { mediaType, base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  };
}
