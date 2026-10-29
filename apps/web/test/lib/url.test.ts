import { describe, expect, it } from "vitest";
import { safeHref } from "@/lib/url";

describe("safeHref", () => {
  it("passes absolute http and https links through", () => {
    expect(safeHref("https://linear.app/ric/issue/RIC-1")).toBe("https://linear.app/ric/issue/RIC-1");
    expect(safeHref("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });

  it("refuses any other scheme, a relative or broken url, and nothing at all", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(" JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHref("/issue/RIC-1")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
