"use client";
import { useState } from "react";

// Approve is two buttons, not one: the merge is done server-side and the user chooses how
// it lands — a local fast-forward onto the default branch, or a pushed branch + MR/PR.
export default function QaVerdictButtons(
  { pending, onApprove, onReject }:
  { pending: "approve-local" | "approve-mr" | "reject" | null;
    onApprove: (arg: "approve-local" | "approve-mr") => void; onReject: (reason: string) => void },
) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  // The server-side merge takes 10s+: while any verdict is in flight, every button is
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
      {rejecting ? (
        <>
          <textarea
            className="reason"
            placeholder="Rejection reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => onReject(reason)}>
            {pending === "reject" ? "Rejecting…" : "confirm reject"}
          </button>
        </>
      ) : (
        <button className="btn danger" disabled={busy} onClick={() => setRejecting(true)}>reject</button>
      )}
    </div>
  );
}
