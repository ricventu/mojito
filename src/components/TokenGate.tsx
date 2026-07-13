"use client";
import { useState } from "react";

export default function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <main style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
      <h1>Mojito</h1>
      <p>Enter your access token.</p>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="token"
        style={{ width: "100%", padding: 12, fontSize: 16 }} />
      <button onClick={() => onSet(v)} style={{ marginTop: 12, padding: 12, width: "100%" }}>Save</button>
    </main>
  );
}
