import { describe, expect, it, vi } from "vitest";
import { terminalKeyHandler } from "@/lib/terminal/keyHandler";

const key = (type: string, k: string, shiftKey = false) => ({ type, key: k, shiftKey, preventDefault: vi.fn() });

describe("terminalKeyHandler", () => {
  it("sends Shift+Enter as LF, claude's newline", () => {
    const send = vi.fn();
    const e = key("keydown", "Enter", true);
    expect(terminalKeyHandler(send)(e)).toBe(false);
    expect(send).toHaveBeenCalledWith("\n");
  });

  it("cancels the Shift+Enter keydown, so no keypress follows to send a CR that submits", () => {
    const e = key("keydown", "Enter", true);
    terminalKeyHandler(vi.fn())(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("leaves a plain Enter and other keys to xterm", () => {
    const send = vi.fn();
    const handle = terminalKeyHandler(send);
    for (const e of [key("keydown", "Enter"), key("keydown", "a", true), key("keyup", "Enter", true)]) {
      expect(handle(e)).toBe(true);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
  });
});
