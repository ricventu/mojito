import { describe, it, expect } from "vitest";
import { withSession } from "@/lib/launchedSession";
import type { SessionMeta } from "@/server/types";

const meta = (id: string): SessionMeta => ({
  kind: "custom", id, ticket: "", launchStatus: "", model: "opus", effort: "high",
  state: "starting", cwd: "/code", createdAt: "2026-08-19T00:00:00.000Z", title: id, labels: [],
});

describe("withSession", () => {
  it("puts a just-launched session at the front so its url resolves at once", () => {
    const list = [meta("mojito-RIC-1-work")];
    expect(withSession(list, meta("mojito-RIC-2-work")).map((s) => s.id))
      .toEqual(["mojito-RIC-2-work", "mojito-RIC-1-work"]);
  });

  it("returns the same list when the session is already known", () => {
    const list = [meta("mojito-RIC-1-work")];
    expect(withSession(list, meta("mojito-RIC-1-work"))).toBe(list);
  });
});
