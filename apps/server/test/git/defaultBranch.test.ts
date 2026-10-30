import { describe, expect, it } from "vitest";
import { defaultBase } from "../../src/git/defaultBranch";
import type { RefEntry } from "../../src/git/graph";

const entries = (...names: string[]): RefEntry[] =>
  names.map((name) => ({ hash: `h-${name}`, ref: { name, kind: name.startsWith("origin/") ? "remote" : "local" }, date: 0 }));

describe("defaultBase", () => {
  it("takes the branch origin/HEAD points at when it is there", () => {
    expect(defaultBase(entries("origin/main", "origin/develop"), "origin/develop", "feat")).toEqual({ name: "origin/develop", hash: "h-origin/develop" });
  });

  it("falls to origin/main without an origin/HEAD", () => {
    expect(defaultBase(entries("main", "origin/main", "origin/master"), null, "feat")?.name).toBe("origin/main");
  });

  it("falls to origin/master when that is the only one", () => {
    expect(defaultBase(entries("main", "origin/master"), null, "feat")?.name).toBe("origin/master");
  });

  it("falls to a local main without a remote", () => {
    expect(defaultBase(entries("main", "master"), null, "feat")).toEqual({ name: "main", hash: "h-main" });
  });

  it("skips the branch itself", () => {
    expect(defaultBase(entries("main", "master"), null, "main")?.name).toBe("master");
    expect(defaultBase(entries("origin/main", "main"), "origin/main", "origin/main")?.name).toBe("main");
  });

  it("answers null when nothing is there", () => {
    expect(defaultBase(entries("feat"), null, "feat")).toBeNull();
    expect(defaultBase([], null, "")).toBeNull();
  });

  it("skips an origin/HEAD that names a missing ref", () => {
    expect(defaultBase(entries("origin/main"), "origin/gone", "feat")?.name).toBe("origin/main");
  });

  it("never takes a tag", () => {
    const tag: RefEntry = { hash: "t", ref: { name: "main", kind: "tag" }, date: 0 };
    expect(defaultBase([tag], null, "feat")).toBeNull();
  });
});
