import { describe, it, expect, vi } from "vitest";
import { tapProps } from "@/lib/tapProps";

// A minimal stand-in for React.KeyboardEvent — just the two members onKeyDown reads.
function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() };
}

describe("tapProps", () => {
  it("sets role and tabIndex so the div is focusable and announced as a button", () => {
    const props = tapProps(() => {});
    expect(props.role).toBe("button");
    expect(props.tabIndex).toBe(0);
  });

  it("invokes the handler on click", () => {
    const onActivate = vi.fn();
    tapProps(onActivate).onClick();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("invokes the handler on Enter", () => {
    const onActivate = vi.fn();
    tapProps(onActivate).onKeyDown(keyEvent("Enter") as never);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("invokes the handler on Space and prevents the page scroll", () => {
    const onActivate = vi.fn();
    const e = keyEvent(" ");
    tapProps(onActivate).onKeyDown(e as never);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does nothing on an unrelated key", () => {
    const onActivate = vi.fn();
    const e = keyEvent("Tab");
    tapProps(onActivate).onKeyDown(e as never);
    expect(onActivate).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
