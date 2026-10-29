import { describe, expect, it } from "vitest";
import { isDocked, sidebarReducer, type SidebarModel } from "@/lib/sidebarState";

const docked: SidebarModel = { open: true, pinned: true };

describe("sidebarReducer", () => {
  it("toggle on a docked sidebar closes and unpins it", () => {
    expect(sidebarReducer(docked, { type: "toggle", canPin: true })).toEqual({ open: false, pinned: false });
  });

  it("close on a docked sidebar unpins it", () => {
    expect(sidebarReducer(docked, { type: "close", canPin: true })).toEqual({ open: false, pinned: false });
  });

  it("close on an overlay keeps the pin as it was", () => {
    expect(sidebarReducer({ open: true, pinned: true }, { type: "close", canPin: false })).toEqual({
      open: false,
      pinned: true,
    });
  });

  it("unpinning a docked sidebar closes it", () => {
    expect(sidebarReducer(docked, { type: "setPinned", pinned: false, canPin: true })).toEqual({
      open: false,
      pinned: false,
    });
  });

  it("pinning the overlay docks it", () => {
    const next = sidebarReducer({ open: true, pinned: false }, { type: "setPinned", pinned: true, canPin: true });
    expect(next).toEqual({ open: true, pinned: true });
    expect(isDocked(next, true)).toBe(true);
  });

  it("losing the breakpoint closes a docked sidebar and keeps the pin", () => {
    const next = sidebarReducer(docked, { type: "canPinChanged", canPin: false });
    expect(next).toEqual({ open: false, pinned: true });
  });

  it("reaching the breakpoint opens a pinned sidebar, docked", () => {
    const next = sidebarReducer({ open: false, pinned: true }, { type: "canPinChanged", canPin: true });
    expect(next).toEqual({ open: true, pinned: true });
    expect(isDocked(next, true)).toBe(true);
  });

  it("a breakpoint change leaves an unpinned sidebar alone", () => {
    const overlay: SidebarModel = { open: true, pinned: false };
    expect(sidebarReducer(overlay, { type: "canPinChanged", canPin: false })).toBe(overlay);
    expect(sidebarReducer(overlay, { type: "canPinChanged", canPin: true })).toBe(overlay);
  });

  it("toggle below the breakpoint only flips open, whatever the remembered pin", () => {
    const closed: SidebarModel = { open: false, pinned: true };
    const opened = sidebarReducer(closed, { type: "toggle", canPin: false });
    expect(opened).toEqual({ open: true, pinned: true });
    expect(isDocked(opened, false)).toBe(false);
    expect(sidebarReducer(opened, { type: "toggle", canPin: false })).toEqual(closed);
  });
});

describe("isDocked", () => {
  it("needs open, pinned and the breakpoint", () => {
    expect(isDocked(docked, true)).toBe(true);
    expect(isDocked(docked, false)).toBe(false);
    expect(isDocked({ open: false, pinned: true }, true)).toBe(false);
    expect(isDocked({ open: true, pinned: false }, true)).toBe(false);
  });
});
