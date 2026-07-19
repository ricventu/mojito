import { describe, it, expect } from "vitest";
import { extForType, pastedImageDir } from "@/lib/pastedImagePath";

describe("extForType", () => {
  it("maps each Claude-supported type to an extension", () => {
    expect(extForType("image/png")).toBe(".png");
    expect(extForType("image/jpeg")).toBe(".jpg");
    expect(extForType("image/gif")).toBe(".gif");
    expect(extForType("image/webp")).toBe(".webp");
  });
  it("returns null for an unsupported type", () => {
    expect(extForType("image/svg+xml")).toBeNull();
    expect(extForType("image/heic")).toBeNull();
    expect(extForType("")).toBeNull();
  });
  it("returns null for Object.prototype key names", () => {
    expect(extForType("constructor")).toBeNull();
    expect(extForType("toString")).toBeNull();
    expect(extForType("hasOwnProperty")).toBeNull();
    expect(extForType("__proto__")).toBeNull();
  });
});

describe("pastedImageDir", () => {
  it("builds a per-session dir under <cwd>/.mojito/pasted", () => {
    expect(pastedImageDir("/repo", "mojito-RIC-1-to-code")).toBe("/repo/.mojito/pasted/mojito-RIC-1-to-code");
  });
});
