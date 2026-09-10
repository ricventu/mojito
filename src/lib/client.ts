export function apiFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-mojito-token": token, "Content-Type": "application/json" },
  }).then((res) => {
    if (res.status === 401) {
      // A 401 means the stored token is no longer valid — clear it so the login
      // gate reappears instead of the app sitting on a blank/unauthorized state.
      window.dispatchEvent(new CustomEvent("mojito-unauthorized"));
    }
    return res;
  });
}
