// Unauthenticated liveness probe for the supervisors (scripts/dev-supervisor.sh,
// scripts/prod-supervisor.mjs) and for `make restart`.
// When Next is wedged (e.g. .next invalidated by a merge in the main checkout),
// every request through the handler 500s — including this one. 200 = alive.
//
// `x-mojito-boot` names this server process, so "Pull & deploy" can tell the restarted
// server from the old one (src/lib/deployPoll.ts). Seeing it go down is not enough:
// on Linux the restart is a few seconds, shorter than the poll interval.
export const dynamic = "force-dynamic";

const BOOT = `${process.pid}-${Date.now()}`;

export function GET(): Response {
  return new Response("ok", { headers: { "x-mojito-boot": BOOT } });
}
