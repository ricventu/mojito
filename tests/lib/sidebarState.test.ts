import { describe, it, expect } from "vitest";
import {
  SIDEBAR_PIN_KEY, readPin, storedPin, sidebarView,
} from "@/lib/sidebarState";

describe("sidebarView", () => {
  const base = { wide: true, pinned: false, open: false, keyboardOpen: false };

  it("is invisible when nothing has asked for it", () => {
    expect(sidebarView(base).visible).toBe(false);
  });

  it("docks a pinned sidebar on a wide viewport, with no tap needed", () => {
    const v = sidebarView({ ...base, pinned: true });
    expect(v).toMatchObject({ visible: true, docked: true, overlay: false });
  });

  it("keeps a pinned sidebar an overlay where there is no room to dock", () => {
    const v = sidebarView({ ...base, wide: false, pinned: true, open: true });
    expect(v).toMatchObject({ visible: true, docked: false, overlay: true });
  });

  // Opening it is a peek: docking would resize the pty and reflow claude's whole TUI
  // for a look at a list, so an unpinned sidebar floats over the terminal instead.
  it("overlays an unpinned sidebar that was opened by hand", () => {
    const v = sidebarView({ ...base, open: true });
    expect(v).toMatchObject({ visible: true, docked: false, overlay: true });
  });

  // The whole point of the pin: nothing dismisses it.
  it("is dismissable in every state but docked", () => {
    expect(sidebarView({ ...base, pinned: true }).dismissable).toBe(false);
    expect(sidebarView({ ...base, open: true }).dismissable).toBe(true);
    expect(sidebarView({ ...base, wide: false, pinned: true, open: true }).dismissable).toBe(true);
  });

  // Same reasoning as the header, which is unmounted for the same band: with the
  // keyboard up the terminal is worth ~13 rows and cannot spare a column either.
  it("hides even a pinned sidebar while the mobile keyboard is up", () => {
    const v = sidebarView({ ...base, pinned: true, open: true, keyboardOpen: true });
    expect(v).toMatchObject({ visible: false, docked: false, overlay: false });
  });

  it("offers the pin only where the sidebar can dock", () => {
    expect(sidebarView(base).canPin).toBe(true);
    expect(sidebarView({ ...base, wide: false }).canPin).toBe(false);
  });
});

describe("pin storage", () => {
  it("round-trips both values", () => {
    expect(readPin(storedPin(true))).toBe(true);
    expect(readPin(storedPin(false))).toBe(false);
  });

  // Never remembered, cleared, or written by an older build: the sidebar starts shut.
  it("reads anything it does not recognise as unpinned", () => {
    expect(readPin(null)).toBe(false);
    expect(readPin("")).toBe(false);
    expect(readPin("true")).toBe(false);
  });

  it("keeps the key out of the filter memory's namespace", () => {
    expect(SIDEBAR_PIN_KEY).toBe("mojito-sidebar-pinned");
  });
});
