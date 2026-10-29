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
  if (files.length > MAX_IMAGES) return { ok: false, error: `too many images (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return { ok: false, error: `unsupported type: ${f.type}` };
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `image too large: ${f.name}` };
  }
  return { ok: true };
}

type Files = ArrayLike<File>;

const images = (files: Files): File[] => Array.from(files).filter((f) => f.type.startsWith("image/"));

/**
 * The images a paste brings, or none when it carries text: then it is a text paste, so copying
 * spreadsheet cells or a Word paragraph (text plus a picture of it) pastes the words alone. Any
 * `image/*` counts, so a type the server refuses is refused with a reason, not ignored.
 */
export function pastedImages(data: { files: Files; getData(type: string): string }): File[] {
  return data.getData("text/plain") ? [] : images(data.files);
}

/** The images a drop brings. */
export function droppedImages(data: { files: Files }): File[] {
  return images(data.files);
}

/**
 * Whether a drag carries files, from its `types` — readable during dragenter/dragover, when the
 * files themselves are not yet. A drag of selected text is the textarea's own, left alone.
 */
export function dragHasFiles(types: ArrayLike<string> | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}
