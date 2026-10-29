import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Whether a presented token is Mojito's, in constant time. Both sides are hashed first:
 * `timingSafeEqual` wants equal lengths, and an early length check would leak the token's.
 */
export function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (given == null) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
