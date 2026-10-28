export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The New-ticket images, checked as a whole with the server's limits and messages
 * (`apps/server/src/tasks/images.ts`) so a refusal is the same wherever it happens.
 */
export function validateImages(
  files: { name: string; type: string; size: number }[],
): { ok: true } | { ok: false; error: string } {
  if (files.length > MAX_IMAGES) return { ok: false, error: `troppe immagini (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return { ok: false, error: `tipo non supportato: ${f.type}` };
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `immagine troppo grande: ${f.name}` };
  }
  return { ok: true };
}
