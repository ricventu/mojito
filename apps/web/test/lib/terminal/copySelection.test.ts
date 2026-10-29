import { describe, it, expect, vi } from "vitest";
import { copyText, osc52Text } from "@/lib/terminal/copySelection";

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

describe("osc52Text", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("decodes the clipboard payload claude sends", () => {
    expect(osc52Text(`c;${b64("hello")}`)).toBe("hello");
  });

  it("decodes UTF-8, not Latin-1", () => {
    expect(osc52Text(`c;${b64("perché → ✓")}`)).toBe("perché → ✓");
  });

  it("accepts an empty or multi-letter selection field", () => {
    expect(osc52Text(`;${b64("a")}`)).toBe("a");
    expect(osc52Text(`pc;${b64("b")}`)).toBe("b");
  });

  it("never answers a clipboard read query", () => {
    expect(osc52Text("c;?")).toBeNull();
  });

  it("ignores a payload that is not base64 or has no separator", () => {
    expect(osc52Text("c;not base64!")).toBeNull();
    expect(osc52Text("garbage")).toBeNull();
    expect(osc52Text("c;")).toBeNull();
  });
});
