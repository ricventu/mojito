import type { EndReason, SessionMeta } from "@mojito/shared";

export interface EndLook {
  /** The badge's word. */
  label: string;
  /** One sentence for the tooltip and the ended terminal. */
  description: string;
  /** Not something the human did: the badge says so in red. */
  abnormal: boolean;
}

const LOOKS: Record<EndReason, EndLook> = {
  exited: { label: "Ended", description: "Claude exited (/exit or Ctrl-D).", abnormal: false },
  other: {
    label: "Stopped",
    description: "Claude stopped without being asked to: a signal, or its terminal closing.",
    abnormal: true,
  },
  oom: {
    label: "Out of memory",
    description: "The system ran out of memory and killed this session's processes.",
    abnormal: true,
  },
  gone: {
    label: "Lost",
    description: "The terminal vanished without Claude ending: a crash, a kill from outside, a reboot.",
    abnormal: true,
  },
};

const UNKNOWN: EndLook = { label: "Ended", description: "Session ended.", abnormal: false };

/**
 * How an ended session's end reads. A row ended before the reason was recorded, or one from a peer
 * that does not send it, has none (null or absent) and reads as a plain end.
 */
export function endLook(reason: EndReason | null | undefined): EndLook {
  return (reason && LOOKS[reason]) || UNKNOWN;
}

/**
 * Whether Resume can start an ended session again: claude's, not a shell's, and with the
 * conversation id the hooks recorded (a session that ended before Mojito kept it has none).
 */
export function canResume(s: Pick<SessionMeta, "state" | "kind" | "claudeSessionId">): boolean {
  return s.state === "ended" && s.kind !== "shell" && s.claudeSessionId !== null && s.claudeSessionId !== undefined;
}
