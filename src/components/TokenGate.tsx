"use client";
import { useState } from "react";

export default function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <main className="gate-screen">
      <h1>Mojito</h1>
      <p>Enter your access token.</p>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="token"
        style={{ width: "100%", fontSize: 16 }} />
      <button className="btn primary block" onClick={() => onSet(v)} style={{ marginTop: 12 }}>Save</button>
    </main>
  );
}
