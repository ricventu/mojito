import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractAssetUrls, isLinearUploadUrl, assetFilename, assetsDir, clearTicketAssets,
  prepareTicketAssets, MAX_ASSETS, ASSET_BUDGET_MS,
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

const png = (n: number) => ({ bytes: Buffer.from([n]), contentType: "image/png" });

describe("prepareTicketAssets", () => {
  it("downloads every description upload and returns url + local path", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "mojito-RIC-46-work",
      description: "![](https://uploads.linear.app/w/a/one.png) ![](https://uploads.linear.app/w/b/two.png)",
      attachments: [],
      download: async (url) => png(url.includes("one") ? 1 : 2),
    });
    expect(got.assets.map((a) => a.url)).toEqual([
      "https://uploads.linear.app/w/a/one.png",
      "https://uploads.linear.app/w/b/two.png",
    ]);
    expect(readFileSync(got.assets[0].localPath)).toEqual(Buffer.from([1]));
    expect(readFileSync(got.assets[1].localPath)).toEqual(Buffer.from([2]));
    expect(got.assets[0].localPath.startsWith(assetsDir(dir, "mojito-RIC-46-work"))).toBe(true);
  });

  it("writes the assets owner-only", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [], download: async () => png(1),
    });
    expect(statSync(got.assets[0].localPath).mode & 0o777).toBe(0o600);
  });

  it("keeps going when one download fails", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/bad.png) ![](https://uploads.linear.app/w/b/good.png)",
      attachments: [],
      download: async (url) => {
        if (url.includes("bad")) throw new Error("404");
        return png(7);
      },
    });
    expect(got.assets).toHaveLength(1);
    expect(got.assets[0].url).toContain("good.png");
  });

  it("downloads Linear attachments and leaves plain links as URLs", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "",
      attachments: [
        { title: "Spec", url: "https://uploads.linear.app/w/a/spec.pdf" },
        { title: "The PR", url: "https://github.com/x/y/pull/1" },
      ],
      download: async () => ({ bytes: Buffer.from([5]), contentType: "application/pdf" }),
    });
    expect(got.assets).toEqual([]);
    expect(got.attachments[0].title).toBe("Spec");
    expect(got.attachments[0].localPath).toMatch(/spec\.pdf$/);
    expect(got.attachments[1]).toEqual({ title: "The PR", url: "https://github.com/x/y/pull/1" });
  });

  it("caps the work list at MAX_ASSETS, description uploads first", async () => {
    const description = Array.from({ length: MAX_ASSETS + 5 },
      (_, i) => `![](https://uploads.linear.app/w/${i}/a.png)`).join(" ");
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description,
      attachments: [{ title: "Late", url: "https://uploads.linear.app/w/late/z.png" }],
      download: async () => png(1),
    });
    expect(got.assets).toHaveLength(MAX_ASSETS);
    expect(got.attachments[0].localPath).toBeUndefined();
  });

  it("gives colliding basenames two distinct files on disk", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/shot.png) ![](https://uploads.linear.app/w/b/shot.png)",
      attachments: [], download: async () => png(1),
    });
    expect(got.assets[0].localPath).not.toBe(got.assets[1].localPath);
    expect(readdirSync(assetsDir(dir, "s"))).toHaveLength(2);
  });

  it("clears a previous run's assets before downloading", async () => {
    const d = assetsDir(dir, "s");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "99-stale.png"), "stale");
    await prepareTicketAssets({
      stateDir: dir, id: "s", description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [], download: async () => png(1),
    });
    expect(readdirSync(d)).toEqual(["01-one.png"]);
  });

  it("returns empty arrays and creates no directory when there is nothing to fetch", async () => {
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description: "no images here", attachments: [],
      download: async () => { throw new Error("must not be called"); },
    });
    expect(got).toEqual({ assets: [], attachments: [] });
    expect(existsSync(assetsDir(dir, "s"))).toBe(false);
  });

  it("never rejects when the state directory cannot be written", async () => {
    // A plain file where the `context` directory belongs: mkdirSync then fails ENOTDIR.
    writeFileSync(join(dir, "context"), "not a directory");
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: "![](https://uploads.linear.app/w/a/one.png)",
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
      download: async () => png(1),
    });
    expect(got.assets).toEqual([]);
    expect(got.attachments).toEqual([{ title: "The PR", url: "https://github.com/x/y/pull/1" }]);
  });

  it("never rejects when the description is not a string", async () => {
    // extractAssetUrls calls description.matchAll — a non-string input throws there,
    // outside every inner try/catch, so only the outer guard catches this.
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s",
      description: undefined as unknown as string,
      attachments: [{ title: "The PR", url: "https://github.com/x/y/pull/1" }],
      download: async () => { throw new Error("must not be called"); },
    });
    expect(got).toEqual({ assets: [], attachments: [] });
  });

  it("stops downloading once the elapsed time reaches the budget, keeping what it already has", async () => {
    const description = Array.from(
      { length: 5 },
      (_, i) => `![](https://uploads.linear.app/w/${i}/a.png)`,
    ).join(" ");
    let clock = 0;
    let calls = 0;
    const got = await prepareTicketAssets({
      stateDir: dir, id: "s", description, attachments: [],
      now: () => clock,
      download: async () => {
        calls += 1;
        // Jump the injected clock past the budget partway through, right after the
        // second job's download starts — the third job's pre-flight check must then
        // see the budget already spent and stop before ever calling download again.
        if (calls === 2) clock = ASSET_BUDGET_MS;
        return png(calls);
      },
    });
    expect(calls).toBe(2);
    expect(got.assets).toHaveLength(2);
    expect(readFileSync(got.assets[0].localPath)).toEqual(Buffer.from([1]));
    expect(readFileSync(got.assets[1].localPath)).toEqual(Buffer.from([2]));
  });
});
