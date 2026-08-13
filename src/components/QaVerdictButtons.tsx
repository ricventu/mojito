"use client";
import type { QaGateModel } from "@/lib/qaGate";

// Approve is two buttons, not one: the merge is done server-side and the user chooses how it
// lands — a local fast-forward onto the default branch, or a pushed branch + MR/PR. A branch
// that is already merged gets neither, only the status write. There is no reject: a ticket
// that fails QA is reworked by typing into the session that built it, which is still alive.
export default function QaVerdictButtons(
  { pending, gate, onApprove, onMarkDone }:
  { pending: "approve-local" | "approve-mr" | "mark-done" | null;
    gate: QaGateModel;
    onApprove: (arg: "approve-local" | "approve-mr") => void;
    onMarkDone: () => void },
) {
  // The server-side merge takes 10s+: while a verdict is in flight, every button is disabled
  // and the one that was clicked says what it is doing.
  const busy = pending !== null;

  if (gate.checking) return <p className="outcome-body">Checking what is left to merge…</p>;

  return (
    <div className="btns">
      {gate.markDone && (
        <button className="btn primary" disabled={busy} onClick={onMarkDone}>
          {pending === "mark-done" ? "Marking Done…" : "Mark Done · nothing to merge"}
        </button>
      )}
      {gate.approve && (
        <>
          <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-local")}>
            {pending === "approve-local" ? "Merging…" : "Approve · merge"}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => onApprove("approve-mr")}>
            {pending === "approve-mr" ? "Opening MR…" : "Approve · MR"}
          </button>
        </>
      )}
    </div>
  );
}
