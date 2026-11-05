import { describe, expect, it } from "vitest";
import { entryScript, hasNewBuild } from "@/lib/appUpdate";

const page = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script><link rel="stylesheet" href="/assets/index.css"></head><body></body></html>`;

describe("entryScript", () => {
  it("reads the page's module script", () => {
    expect(entryScript(page("/assets/index-abc.js"))).toBe("/assets/index-abc.js");
  });

  it("reads it from a serialized document, whose attributes read differently", () => {
    expect(entryScript(`<head><script type="module" crossorigin="" src="/assets/index-abc.js"></script></head>`)).toBe(
      "/assets/index-abc.js",
    );
  });

  it("takes the first one: under Vite that is its client, the same on both sides", () => {
    expect(entryScript(`<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>`)).toBe(
      "/@vite/client",
    );
  });

  it("answers null for a page without one", () => {
    expect(entryScript("<!doctype html><title>Bad gateway</title>")).toBeNull();
    expect(entryScript(`<script src="/classic.js"></script>`)).toBeNull();
  });
});

describe("hasNewBuild", () => {
  const running = "/assets/index-old.js";
  const answer = (body: string, status = 200) => () => Promise.resolve(new Response(body, { status }));

  it("is true when the served page names another entry script", async () => {
    await expect(hasNewBuild(running, answer(page("/assets/index-new.js")))).resolves.toBe(true);
  });

  it("is false for the same build", async () => {
    await expect(hasNewBuild(running, answer(page(running)))).resolves.toBe(false);
  });

  // A check that cannot tell must never prompt: a deploy is mid-build, or a proxy answered.
  it("is false when the check fails", async () => {
    await expect(hasNewBuild(running, () => Promise.reject(new Error("offline")))).resolves.toBe(false);
    await expect(hasNewBuild(running, answer(page("/assets/index-new.js"), 502))).resolves.toBe(false);
    await expect(hasNewBuild(running, answer("<title>not the app</title>"))).resolves.toBe(false);
  });

  it("is false when the running page's own script is unknown", async () => {
    await expect(hasNewBuild(null, answer(page("/assets/index-new.js")))).resolves.toBe(false);
  });
});
