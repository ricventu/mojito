import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";

export interface DecodedImage {
  filename: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { contentType: m[1], bytes: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

export function validateImages(
  input: unknown,
): { ok: true; files: DecodedImage[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, files: [] };
  if (!Array.isArray(input)) return { ok: false, error: "images must be an array" };
  if (input.length > MAX_IMAGES) return { ok: false, error: `too many images (max ${MAX_IMAGES})` };
  const files: DecodedImage[] = [];
  for (const item of input) {
    if (!item || typeof item.dataUrl !== "string" || typeof item.type !== "string") {
      return { ok: false, error: "invalid image entry" };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(item.type)) {
      return { ok: false, error: `unsupported image type: ${item.type}` };
    }
    const parsed = parseDataUrl(item.dataUrl);
    if (!parsed) return { ok: false, error: "malformed image data" };
    if (parsed.contentType !== item.type) return { ok: false, error: "image type mismatch" };
    if (parsed.bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `image too large (max ${MAX_IMAGE_BYTES} bytes)` };
    }
    const filename = typeof item.name === "string" && item.name ? item.name : "image";
    files.push({ filename, contentType: item.type, size: parsed.bytes.length, bytes: parsed.bytes });
  }
  return { ok: true, files };
}
