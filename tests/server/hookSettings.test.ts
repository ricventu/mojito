import { describe, it, expect } from "vitest";
import { buildHookSettings } from "@/server/hookSettings";

describe("buildHookSettings", () => {
  const s = buildHookSettings("mojito-RIC-46-planned", 4711);

  it("defines all four hook events", () => {
    expect(Object.keys(s.hooks).sort()).toEqual(
      ["Notification", "PermissionRequest", "SessionEnd", "Stop"].sort(),
    );
  });

  it("each command targets the localhost sink with session and event", () => {
    const stop = JSON.stringify(s.hooks.Stop);
    expect(stop).toContain("127.0.0.1:4711/api/hook");
    expect(stop).toContain("session=mojito-RIC-46-planned");
    expect(stop).toContain("event=Stop");
    expect(stop).toContain("--data-binary @-"); // forwards hook stdin
    expect(stop).toContain("|| true");          // never blocks claude
  });
});
