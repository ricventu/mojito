// Unauthenticated liveness probe for the dev supervisor (scripts/dev-supervisor.sh).
// When Next is wedged (e.g. .next invalidated by a merge in the main checkout),
// every request through the handler 500s — including this one. 200 = alive.
export function GET(): Response {
  return new Response("ok");
}
