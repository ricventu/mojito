import { describe, expect, it } from "vitest";
import { OOM_LINE, paneScope } from "../../src/sessions/oom";

describe("paneScope", () => {
  const read = (content: string) => () => content;

  it("reads the tmux pane scope off the process's cgroup", () => {
    const cgroup = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-4b743b48-d79b-4260-bf90-583f9b7c1f5c.scope\n";
    expect(paneScope(42, read(cgroup))).toBe("tmux-spawn-4b743b48-d79b-4260-bf90-583f9b7c1f5c.scope");
  });

  it("is none for a cgroup that is no scope, a process gone, or no /proc at all", () => {
    expect(paneScope(42, read("0::/user.slice/user-1000.slice/user@1000.service/mojito.service\n"))).toBeNull();
    expect(paneScope(42, read("0::/\n"))).toBeNull();
    expect(paneScope(42, read("0::/x/-rf.scope\n"))).toBeNull();
    expect(
      paneScope(42, () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});

describe("OOM_LINE", () => {
  it("matches what systemd writes when the kernel's OOM killer hits a unit", () => {
    expect(OOM_LINE.test("tmux-spawn-x.scope: The kernel OOM killer killed some processes in this unit.")).toBe(true);
    expect(OOM_LINE.test("tmux-spawn-x.scope: Consumed 12h CPU time")).toBe(false);
  });
});
