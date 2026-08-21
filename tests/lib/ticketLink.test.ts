import { describe, it, expect } from "vitest";
import { ticketLinkUrl, ticketUrls } from "@/lib/ticketLink";

describe("ticketLinkUrl", () => {
  it("keeps an https issue url", () => {
    expect(ticketLinkUrl("https://linear.app/acme/issue/RIC-242")).toBe(
      "https://linear.app/acme/issue/RIC-242",
    );
  });

  it("keeps a plain http one", () => {
    expect(ticketLinkUrl("http://linear.local/issue/RIC-242")).toBe(
      "http://linear.local/issue/RIC-242",
    );
  });

  it("trims a padded url", () => {
    expect(ticketLinkUrl("  https://linear.app/acme/issue/RIC-242  ")).toBe(
      "https://linear.app/acme/issue/RIC-242",
    );
  });

  it("answers empty for a missing url", () => {
    expect(ticketLinkUrl(undefined)).toBe("");
    expect(ticketLinkUrl(null)).toBe("");
    expect(ticketLinkUrl("")).toBe("");
    expect(ticketLinkUrl("   ")).toBe("");
  });

  it("refuses a scheme the browser would run in Mojito's own origin", () => {
    expect(ticketLinkUrl("javascript:alert(1)")).toBe("");
    expect(ticketLinkUrl("JavaScript:alert(1)")).toBe("");
    expect(ticketLinkUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("refuses a relative url, which would resolve against Mojito itself", () => {
    expect(ticketLinkUrl("/issue/RIC-242")).toBe("");
    expect(ticketLinkUrl("linear.app/acme/issue/RIC-242")).toBe("");
  });

  it("accepts the scheme in any casing, as a url may carry it", () => {
    expect(ticketLinkUrl("HTTPS://linear.app/acme/issue/RIC-242")).toBe(
      "HTTPS://linear.app/acme/issue/RIC-242",
    );
  });
});

describe("ticketUrls", () => {
  const t = (identifier: string, url: string) => ({ identifier, url });

  it("maps identifier to issue url", () => {
    const map = ticketUrls([t("RIC-242", "https://linear.app/a/issue/RIC-242"), t("RIC-1", "https://linear.app/a/issue/RIC-1")]);
    expect(map.get("RIC-242")).toBe("https://linear.app/a/issue/RIC-242");
    expect(map.get("RIC-1")).toBe("https://linear.app/a/issue/RIC-1");
  });

  it("leaves out a ticket with no usable url rather than mapping it to empty", () => {
    const map = ticketUrls([t("RIC-2", ""), { identifier: "RIC-3" }, t("RIC-4", "javascript:alert(1)")]);
    expect(map.has("RIC-2")).toBe(false);
    expect(map.has("RIC-3")).toBe(false);
    expect(map.has("RIC-4")).toBe(false);
  });

  it("answers undefined for a ticket the list never carried", () => {
    expect(ticketUrls([]).get("RIC-242")).toBeUndefined();
  });
});
