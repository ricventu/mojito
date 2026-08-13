"use client";

// Approve is two buttons, not one: the merge is done server-side and the user chooses how
// it lands — a local fast-forward onto the default branch, or a pushed branch + MR/PR.
// There is no reject: a ticket that fails QA is reworked by typing into the session that
// built it, which is still alive.
export default function QaVerdictButtons(
  { pending, onApprove }:
  { pending: "approve-local" | "approve-mr" | null;
    onApprove: (arg: "approve-local" | "approve-mr") => void },
) {
  // The server-side merge takes 10s+: while a verdict is in flight, both buttons are
  // disabled and the one that was clicked says what it is doing.
  const busy = pending !== null;

  return (
    <div className="btns">
      <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-local")}>
        {pending === "approve-local" ? "Merging…" : "Approve · merge"}
      </button>
      <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-mr")}>
        {pending === "approve-mr" ? "Opening MR…" : "Approve · MR"}
      </button>
    </div>
  );
}
