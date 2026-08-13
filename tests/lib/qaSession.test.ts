import { describe, it, expect } from "vitest";
import { qaSessionModel } from "@/lib/qaSession";

describe("qaSessionModel", () => {
  it("offers only a start when no session was ever registered", () => {
    expect(qaSessionModel({ registered: false, active: false })).toEqual({ open: false, start: true });
  });

  it("offers only the open when the work session is still alive", () => {
    expect(qaSessionModel({ registered: true, active: true })).toEqual({ open: true, start: false });
  });

  // The gate's dead end: the pane died (or an approve-conflict verdict superseded the session)
  // and the registry entry stayed, so the sheet showed "Open session (done)" and nothing else.
  // Both belong here — the scrollback is still worth reading, and the work still needs a session.
  it("offers both when a registered session is no longer alive", () => {
    expect(qaSessionModel({ registered: true, active: false })).toEqual({ open: true, start: true });
  });
});
