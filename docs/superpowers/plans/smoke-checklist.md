# Mojito smoke checklist

**Automated gate verified:** Item 0 (Stop-vs-SessionEnd hook behavior) and the full unit/integration/build suite (`npm run test`, `npm run typecheck`, `npm run build`) are run in CI/CD. Items 1–13 below are live end-to-end steps for the operator to execute against a real environment (phone on LAN, real Linear ticket, `npm run dev` active).

Prereqs (for live steps): tmux + claude on PATH, a real non-closed Linear ticket, `.env` filled in, `npm run dev` running, phone on the same LAN.

---

## 0. **Stop-vs-SessionEnd behavior (verify FIRST — spec §3 caveat).**

Launch `claude "/lime-next <TICKET>"` manually in a terminal. After the stage's turn completes, observe whether claude stays interactive (fires `Stop`) or exits (fires `SessionEnd`). Confirm the injected hooks POST to `/api/hook`. Record which event fires at stage end; both are handled, but this confirms the assumption.

## 1. Open `http://<LAN-IP>:4711` on the phone

Enter the token → tab shell appears.

## 2. Tickets tab lists your non-closed tickets grouped by project

Verify tickets appear correctly by project.

## 3. Tap a ticket → launch sheet

Model=opus, effort=high default → Start → 201 response.
`tmux ls` shows `mojito-<TICKET>-<slug>`.

## 4. Sessions tab shows the session as running (●)

Verify the session card displays as active.

## 5. When claude asks for a permission → card turns amber (⚠), a toast + sound fire

Confirm permission request notifications work.

## 6. Open the terminal → claude's TUI renders

Answer with the accessory bar (`1/2/3`, Enter).

## 7. Let the stage finish → status advances in Linear

Card shows done (✓), "stage complete" alert.

## 8. Background the phone during a running session, return → terminal reconnects

Verify scrollback is preserved.

## 9. Dismiss a done session → it disappears

`tmux ls` no longer lists it.

## 10. Try launching the same ticket+status twice → the sheet shows "Open running session" (dedup)

Verify session deduplication works.

## 11. Enable auto-advance on a ticket

After a non-gate stage completes, the next stage launches automatically.

## 12. Reach a gate (To QA / To Merge) → auto-advance stops

The terminal shows gate buttons; tapping posts the arg.

## 13. Restart `npm run dev` mid-session → the session reappears (boot recovery)

The terminal reattaches.
