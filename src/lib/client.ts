export function apiFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-mojito-token": token, "Content-Type": "application/json" },
  });
}
