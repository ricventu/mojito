# Toggle auto-advance on started sessions

## Problem

`autoAdvance` is a per-session boolean set once at launch time (the LaunchSheet
checkbox) and carried forward on every relaunch. After a session starts there is
no way to change it. Users want to turn auto-advance on or off for tickets that
are already running.

## Behavior

- The toggle only changes the stored flag. It does **not** launch anything
  immediately.
- `decideAutoAdvance(newStatus, autoAdvance)` reads the flag at stop-time
  (`hookHandler.ts`), so a change takes effect at the session's **next** stage
  transition.
- A session already parked at a gate (`To QA` / `To Merge`) or done stays put
  until the user presses the existing advance button. Turning the flag on does
  not retroactively advance it. (The gate advance route already carries the
  current flag forward, so stages *after* the gate honor the new value.)

## Backend

Add `PATCH` to `src/app/api/sessions/[id]/route.ts` (alongside `DELETE`):

- Auth via `tokenFromHeaders`; `401` on failure.
- Parse JSON body; `400` on bad JSON.
- Require `body.autoAdvance` to be a boolean; `400` otherwise.
- `const next = getRegistry().patch(id, { autoAdvance: body.autoAdvance })`.
  - `404` if `next` is undefined (unknown session).
- Emit `getBus().emit({ type: "session.state", id, state: next.state })` so all
  connected clients refetch. Reuses the existing event type — `page.tsx`
  refetches sessions on *any* event — so no new `MojitoEvent` variant is needed.
- Return `NextResponse.json(next)`.

`Registry.patch` already persists the sidecar via `upsert`, so no persistence
changes are required.

## Frontend

Both placements (per user):

### SessionList card (`src/components/SessionList.tsx`)

Replace the static badge:

```tsx
{s.autoAdvance && <span className="chip">auto</span>}
```

with an interactive toggle styled to match `.chip`:

- Label `auto: on` / `auto: off` reflecting `s.autoAdvance`.
- `onClick` calls `e.stopPropagation()` (the parent `.tap` div opens the
  session) then PATCHes `/api/sessions/${s.id}` with the negated flag, then
  calls `onChanged()` to refetch.
- Rendered for every session. Harmless on terminal sessions; meaningful for any
  session with stages remaining.

### TerminalView (`src/components/TerminalView.tsx`)

- Local state `const [auto, setAuto] = useState(session.autoAdvance)`.
- A small toggle button in the header next to `{session.ticket} · {session.launchStatus}`.
- On tap: PATCH with `!auto`, then `setAuto(!auto)` optimistically. (The `open`
  session prop in `page.tsx` is a snapshot and is not re-threaded, so local
  state is the source of truth for this view.)

### Client helper

`apiFetch` already sets `Content-Type: application/json` and the token header, so
each component calls it directly with `method: "PATCH"` and a JSON body. No new
lib module.

## Tests

Add `tests/server/patchSession.test.ts` (or extend an existing server test):

- PATCH toggles `autoAdvance` on a registered session and returns the updated
  meta.
- Non-boolean / missing `autoAdvance` body → `400`.
- Unknown id → `404`.

The `decideAutoAdvance` matrix and `hookHandler` auto-advance behavior are
already covered by existing tests and are unchanged.

## Out of scope

- No change to launch defaults or the LaunchSheet checkbox.
- No immediate advance-on-toggle.
- No new global auto-advance setting.
