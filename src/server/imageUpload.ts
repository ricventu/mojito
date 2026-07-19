import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/imageConstants";

export interface DecodedImage {
  filename: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

const BASE64_CHAR = /^[A-Za-z0-9+/]$/;

function isValidBase64(payload: string): boolean {
  // `Buffer.from(x, "base64")` silently ignores invalid characters instead of
  // throwing, so a strict charset/padding check is required to reject garbage.
  // Checked char-by-char (rather than one large regex) to avoid catastrophic
  // backtracking / stack overflow on large (multi-MB) payloads.
  if (payload.length === 0) return true;
  if (payload.length % 4 !== 0) return false;
  let paddingSeen = false;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (ch === "=") {
      paddingSeen = true;
      // Padding, once it starts, must run to the end and be at most 2 chars.
      if (payload.length - i > 2) return false;
      continue;
    }
    if (paddingSeen) return false; // non-padding char after padding started
    if (!BASE64_CHAR.test(ch)) return false;
  }
  return true;
}

function parseDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  if (!isValidBase64(m[2])) return null;
  try {
    return { contentType: m[1], bytes: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

export function validateImages(
  input: unknown,
  maxBytes: number = MAX_IMAGE_BYTES,
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
    if (parsed.bytes.length > maxBytes) {
      return { ok: false, error: `image too large (max ${maxBytes} bytes)` };
    }
    const filename = typeof item.name === "string" && item.name ? item.name : "image";
    files.push({ filename, contentType: item.type, size: parsed.bytes.length, bytes: parsed.bytes });
  }
  return { ok: true, files };
}
