// Unauthenticated liveness probe for the supervisors (scripts/dev-supervisor.sh,
// scripts/prod-supervisor.mjs) and for `make restart`.
// When Next is wedged (e.g. .next invalidated by a merge in the main checkout),
// every request through the handler 500s — including this one. 200 = alive.
export function GET(): Response {
  return new Response("ok");
}
