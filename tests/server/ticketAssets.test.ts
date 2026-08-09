import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAssetUrls, isLinearUploadUrl, assetFilename, assetsDir, clearTicketAssets,
} from "@/server/ticketAssets";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("isLinearUploadUrl", () => {
  it("accepts a Linear upload URL", () => {
    expect(isLinearUploadUrl("https://uploads.linear.app/a/b/c.png")).toBe(true);
  });

  it("rejects a lookalike host", () => {
    expect(isLinearUploadUrl("https://uploads.linear.app.evil.com/a.png")).toBe(false);
  });

  it("rejects an unrelated host", () => {
    expect(isLinearUploadUrl("https://github.com/x/y/pull/1")).toBe(false);
  });
});

describe("extractAssetUrls", () => {
  it("finds a markdown image, a markdown link, and a bare URL", () => {
    const urls = extractAssetUrls([
      "![shot](https://uploads.linear.app/w/a/one.png)",
      "[the log](https://uploads.linear.app/w/b/two.txt)",
      "see https://uploads.linear.app/w/c/three.pdf for the rest",
    ].join("\n"));
    expect(urls).toEqual([
      "https://uploads.linear.app/w/a/one.png",
      "https://uploads.linear.app/w/b/two.txt",
      "https://uploads.linear.app/w/c/three.pdf",
    ]);
  });

  it("collapses duplicates and keeps first-appearance order", () => {
    const urls = extractAssetUrls(
      "![](https://uploads.linear.app/b.png) ![](https://uploads.linear.app/a.png) ![](https://uploads.linear.app/b.png)",
    );
    expect(urls).toEqual(["https://uploads.linear.app/b.png", "https://uploads.linear.app/a.png"]);
  });

  it("trims trailing sentence punctuation", () => {
    expect(extractAssetUrls("look at https://uploads.linear.app/w/a.png."))
      .toEqual(["https://uploads.linear.app/w/a.png"]);
  });

  it("ignores non-Linear hosts and the bare host with no path", () => {
    expect(extractAssetUrls("https://example.com/a.png and https://uploads.linear.app/")).toEqual([]);
  });

  it("returns nothing for an empty description", () => {
    expect(extractAssetUrls("")).toEqual([]);
  });
});

describe("assetFilename", () => {
  it("indexes and keeps a clean basename", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/shot.png", 1, "image/png")).toBe("01-shot.png");
  });

  it("indexes past nine without losing order", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/shot.png", 12, "image/png")).toBe("12-shot.png");
  });

  it("appends an extension derived from the content type when the URL has none", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/abcdef", 2, "application/pdf")).toBe("02-abcdef.pdf");
  });

  it("falls back to .bin for an unknown content type", () => {
    expect(assetFilename("https://uploads.linear.app/w/a/abcdef", 3, "application/zip")).toBe("03-abcdef.bin");
  });

  it("sanitizes a traversal-shaped segment into a flat name", () => {
    const name = assetFilename("https://uploads.linear.app/w/..%2F..%2Fetc%2Fpasswd", 1, "image/png");
    expect(name).toBe("01-.._.._etc_passwd.png");
    expect(name).not.toContain("/");
  });

  it("degrades an empty or dot-only segment to 'asset'", () => {
    expect(assetFilename("https://uploads.linear.app/w/", 1, "image/png")).toBe("01-asset.png");
    expect(assetFilename("https://uploads.linear.app/w/..", 1, "image/png")).toBe("01-asset.png");
  });

  it("gives colliding basenames distinct filenames", () => {
    const a = assetFilename("https://uploads.linear.app/w/x/shot.png", 1, "image/png");
    const b = assetFilename("https://uploads.linear.app/w/y/shot.png", 2, "image/png");
    expect(a).not.toBe(b);
  });
});

describe("assetsDir / clearTicketAssets", () => {
  it("sits beside the context file", () => {
    expect(assetsDir("/state", "mojito-RIC-46-work")).toBe(join("/state", "context", "mojito-RIC-46-work-assets"));
  });

  it("removes a previous run's files", () => {
    const d = assetsDir(dir, "mojito-RIC-46-work");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "01-old.png"), "stale");
    clearTicketAssets(dir, "mojito-RIC-46-work");
    expect(existsSync(d)).toBe(false);
  });

  it("is a no-op when the directory never existed", () => {
    expect(() => clearTicketAssets(dir, "mojito-RIC-99-work")).not.toThrow();
  });
});
