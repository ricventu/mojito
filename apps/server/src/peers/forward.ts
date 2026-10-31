import type { LaunchBody } from "@mojito/shared";
import type { PeerConfig } from "../config";

export type ForwardResult = { status: number; body: unknown };

const TIMEOUT_MS = 30_000;

/**
 * A launch on a peer: `POST <peer>/api/sessions` with the shared token, its status and json body
 * answered verbatim — the peer runs its own launch (its ticket cache, prompts, Linear writes).
 * Unreachable, or an answer that is not json: 502. No answer within the limit: 504, worded so a
 * slow Linear write does not read as a failed launch — if the session started, the peer link
 * shows it.
 */
export async function forwardLaunch(
  peer: PeerConfig,
  token: string,
  body: LaunchBody,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ForwardResult> {
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(`${peer.url}/api/sessions`, {
      method: "POST",
      headers: { "x-mojito-token": token, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { status: 504, body: { error: `${peer.name} did not answer within ${TIMEOUT_MS / 1000} s: the session may still be starting` } };
    }
    return unreachable(peer);
  }
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return unreachable(peer);
  }
}

const unreachable = (peer: PeerConfig): ForwardResult => ({ status: 502, body: { error: `${peer.name} is not reachable` } });
