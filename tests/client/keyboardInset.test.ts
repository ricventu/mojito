import { describe, it, expect } from "vitest";
import { termRootStyle } from "@/lib/keyboardInset";

describe("termRootStyle", () => {
  it("keyboard closed: fills the full viewport with no offset", () => {
    expect(termRootStyle({ height: 844, offsetTop: 0 })).toEqual({
      height: "844px",
      transform: "translateY(0px)",
    });
  });

  it("keyboard open: shrinks height to the visible band", () => {
    expect(termRootStyle({ height: 500, offsetTop: 0 })).toEqual({
      height: "500px",
      transform: "translateY(0px)",
    });
  });

  it("offset visual viewport: shifts the fixed container down to the visible top", () => {
    expect(termRootStyle({ height: 500, offsetTop: 40 })).toEqual({
      height: "500px",
      transform: "translateY(40px)",
    });
  });

  it("rounds fractional metrics to whole pixels", () => {
    expect(termRootStyle({ height: 499.6, offsetTop: 12.3 })).toEqual({
      height: "500px",
      transform: "translateY(12px)",
    });
  });

  it("clamps negative metrics to zero", () => {
    expect(termRootStyle({ height: -10, offsetTop: -5 })).toEqual({
      height: "0px",
      transform: "translateY(0px)",
    });
  });
});
