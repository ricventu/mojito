import { describe, it, expect, vi } from "vitest";
import { copyText } from "@/lib/terminal/copySelection";

describe("copyText", () => {
  it("writes through the async clipboard when there is one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCopy = vi.fn();
    expect(await copyText("hello", { clipboard: { writeText }, execCopy })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCopy).not.toHaveBeenCalled();
  });

  it("falls back to execCommand outside a secure context", async () => {
    const execCopy = vi.fn().mockReturnValue(true);
    expect(await copyText("hello", { execCopy })).toBe(true);
    expect(execCopy).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the async clipboard refuses", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const execCopy = vi.fn().mockReturnValue(true);
    expect(await copyText("hello", { clipboard: { writeText }, execCopy })).toBe(true);
    expect(execCopy).toHaveBeenCalledWith("hello");
  });

  it("reports a copy that neither path managed", async () => {
    expect(await copyText("hello", { execCopy: () => false })).toBe(false);
  });

  it("copies nothing for an empty selection", async () => {
    const execCopy = vi.fn();
    expect(await copyText("", { execCopy })).toBe(false);
    expect(execCopy).not.toHaveBeenCalled();
  });
});
