"use client";
import { useEffect, useRef } from "react";

export default function AlertLayer(
  { alerts, onOpen, onClear }:
  { alerts: { id: string; ticket: string; message: string }[]; onOpen: (id: string) => void; onClear: () => void },
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const unlocked = useRef(false);

  useEffect(() => {
    const unlock = () => { unlocked.current = true; };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (alerts.length && unlocked.current) audio.current?.play().catch(() => {});
  }, [alerts.length]);

  if (alerts.length === 0) return <audio ref={audio} src="/alert.mp3" preload="auto" />;
  const top = alerts[0];
  return (
    <>
      <audio ref={audio} src="/alert.mp3" preload="auto" />
      <div style={{ position: "fixed", top: 8, left: 8, right: 8, zIndex: 50 }}>
        <div onClick={() => onOpen(top.id)}
          style={{ background: "#a70", color: "#fff", padding: 14, borderRadius: 12 }}>
          <strong>{top.ticket}</strong> — {top.message}
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={{ float: "right" }}>×</button>
        </div>
      </div>
    </>
  );
}
