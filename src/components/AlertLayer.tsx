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
        <div className="alert" onClick={() => onOpen(top.id)}>
          <span className="id">{top.ticket}</span>
          <span>{top.message}</span>
          <button className="x" onClick={(e) => { e.stopPropagation(); onClear(); }}>×</button>
        </div>
      </div>
    </>
  );
}
