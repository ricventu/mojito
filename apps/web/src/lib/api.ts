import { clearToken, getToken } from "@/lib/token";

/** A non-2xx answer. `body` is the parsed json (or text) so callers can read extras such as `sessionId`. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * fetch against the Mojito server: adds the token header, parses json and turns a
 * non-2xx answer into an `ApiError`. A 401 also forgets the stored token, which is what
 * brings the token gate back. Callers set their own content-type (FormData must not get
 * one — the browser adds the multipart boundary); see `apiJson` for the json case.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  const body = await readBody(res);
  if (!res.ok) throw failure(res, body);
  return body as T;
}

/** `apiFetch` for a binary answer (an image): the bytes as a blob; a failure reads as `apiFetch`'s. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await send(path, {});
  if (!res.ok) throw failure(res, await readBody(res));
  return res.blob();
}

function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-mojito-token", getToken());
  return fetch(path, { ...init, headers });
}

function failure(res: Response, body: unknown): ApiError {
  if (res.status === 401) clearToken();
  const message =
    body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : res.statusText;
  return new ApiError(res.status, message, body);
}

/** `apiFetch` with a json body. */
export function apiJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
