"use client";
import { useState } from "react";

export default function QaVerdictButtons(
  { onApprove, onReject }: { onApprove: () => void; onReject: (reason: string) => void },
) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="btns">
      <button className="btn primary" onClick={onApprove}>approve</button>
      {rejecting ? (
        <>
          <textarea
            className="reason"
            placeholder="Rejection reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onReject(reason)}>
            confirm reject
          </button>
        </>
      ) : (
        <button className="btn danger" onClick={() => setRejecting(true)}>reject</button>
      )}
    </div>
  );
}
