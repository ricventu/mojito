import { describe, it, expect } from "vitest";
import { gitTargetQuery } from "@/lib/useGitGraph";

describe("gitTargetQuery", () => {
  it.each([
    [{ project: "Factory Book" }, "project=Factory+Book"],
    [{ session: "mojito-RIC-1-work" }, "session=mojito-RIC-1-work"],
    [{ ticket: "RIC-1", project: "Mojito" }, "ticket=RIC-1&project=Mojito"],
    [{ ticket: "RIC-1", project: null }, "ticket=RIC-1"],
  ])("builds %j", (target, q) => expect(gitTargetQuery(target)).toBe(q));
});
