import { describe, it, expect } from "vitest";
import { terminalOptions } from "@/lib/terminalOptions";

describe("terminalOptions", () => {
  // The regression this guards: tmux's terminfo for `xterm-256color` (the TERM the
  // pty gateway spawns with) has `cud1=\n`, so tmux walks the cursor down a row
  // with a bare LF and expects the *column to be preserved*. With convertEol on,
  // xterm rewrites that LF as CRLF, the column snaps to 0, and tmux's next cell
  // run lands left of where it belongs. Because tmux redraws differentially —
  // it trusts its own model of what each cell holds — those cells are never
  // repainted, so the corruption is permanent and survives scrolling.
  it("leaves convertEol off so a bare LF keeps the cursor column", () => {
    expect(terminalOptions().convertEol).toBeFalsy();
  });

  // Selection is off for as long as the foreground app has mouse tracking on —
  // claude's TUI always does — because xterm hands it every mouse event
  // instead (`_selectionService.disable()` in CoreBrowserTerminal). Its one
  // escape hatch is `SelectionService.shouldForceSelection`, which on a Mac
  // reads `event.altKey && macOptionClickForcesSelection` — and that option
  // defaults to FALSE, which left macOS with no gesture that selects at all.
  // Setting it also turns Option+drag from a column selection into a normal
  // one (`shouldColumnSelect` excludes exactly this case), which is the point:
  // a block selection of a TUI is not what anyone is copying.
  it("lets Option+drag force a selection on a Mac", () => {
    expect(terminalOptions().macOptionClickForcesSelection).toBe(true);
  });
});
