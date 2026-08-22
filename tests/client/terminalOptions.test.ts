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
});
