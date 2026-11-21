import { describe, expect, it } from "vitest";
import { labelColor } from "@/lib/labels";

describe("labelColor", () => {
  it("answers the label's #rrggbb colour", () => {
    expect(labelColor({ labelColors: { Bug: "#EB5757" } }, "Bug")).toBe("#eb5757");
  });

  it("answers null without colours (an older peer), for a missing label or a bad value", () => {
    expect(labelColor({}, "Bug")).toBeNull();
    expect(labelColor({ labelColors: { Bug: "#eb5757" } }, "Feature")).toBeNull();
    expect(labelColor({ labelColors: { Bug: "red;background:url(x)" } }, "Bug")).toBeNull();
    expect(labelColor({ labelColors: { Bug: 5 as unknown as string } }, "Bug")).toBeNull();
  });

  it("never reads an inherited key", () => {
    expect(labelColor({ labelColors: {} }, "toString")).toBeNull();
  });
});
