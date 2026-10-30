/**
 * The image types a path printed in the terminal opens in the viewer: the ones claude reads
 * and every browser shows. Not SVG — served from Mojito's own origin it could run script.
 */
export const IMAGE_PATH_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"] as const;

/** Larger images are not served: the cap of the images a session is sent (MAX_IMAGE_BYTES). */
export const IMAGE_VIEW_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_NAME = new RegExp(`^.+\\.(?:${IMAGE_PATH_EXTENSIONS.join("|")})$`, "i");

/**
 * A path the session image route may be asked for: non-empty, no NUL, no `..` segment, and a
 * name with a stem and one of `IMAGE_PATH_EXTENSIONS` (any case). Whether the file really is
 * an image is the server's call, from its bytes.
 */
export function isImagePath(p: string): boolean {
  if (!p || p.includes("\0")) return false;
  const segments = p.split("/");
  if (segments.includes("..")) return false;
  return IMAGE_NAME.test(segments[segments.length - 1] ?? "");
}
