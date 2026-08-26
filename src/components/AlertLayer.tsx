"use client";
import { X } from "lucide-react";
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
      <div className="alert-layer">
        <div className="alert" onClick={() => onOpen(top.id)}>
          <span className="id">{top.ticket}</span>
          <span>{top.message}</span>
          <button className="x icon" aria-label="Dismiss alert" onClick={(e) => { e.stopPropagation(); onClear(); }}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
