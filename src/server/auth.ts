export function tokenFromHeaders(headers: Headers, expected: string): boolean {
  return headers.get("x-mojito-token") === expected;
}

export function tokenFromUrl(url: string, expected: string): boolean {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("token") === expected;
}
