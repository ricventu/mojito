"use client";
import { useState } from "react";

export default function TokenGate({ onSet }: { onSet: (t: string) => void }) {
  const [v, setV] = useState("");

  const submit = () => {
    const token = v.trim();
    if (token) {
      onSet(token);
    }
  };

  return (
    <main className="gate-screen">
      <h1>Mojito</h1>
      <p>Enter your access token.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }}
      >
        <input
          type="text"
          inputMode="text"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="token"
          autoComplete="off"
          style={{ width: "100%", fontSize: 16 }}
        />
        <button
          className="btn primary block"
          type="submit"
          style={{ marginTop: 12 }}
        >
          Save
        </button>
      </form>
    </main>
  );
}
