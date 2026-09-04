import { describe, it, expect } from "vitest";
import { CLI_DEFAULTS, parseCliArgs } from "@/cli/args";

describe("parseCliArgs", () => {
  it("defaults to a claude session at the New-session sheet's own model and effort", () => {
    expect(parseCliArgs([])).toEqual({ ...CLI_DEFAULTS });
  });

  it("takes --shell as the plain-terminal kind", () => {
    expect(parseCliArgs(["--shell"]).kind).toBe("shell");
  });

  it("takes -s as the short form of --shell", () => {
    expect(parseCliArgs(["-s"]).kind).toBe("shell");
  });

  it("takes --model and --effort as separate arguments", () => {
    const args = parseCliArgs(["--model", "sonnet", "--effort", "medium"]);
    expect(args.model).toBe("sonnet");
    expect(args.effort).toBe("medium");
  });

  it("takes --model=value too, since a shell user will write it either way", () => {
    expect(parseCliArgs(["--model=fable"]).model).toBe("fable");
  });

  it("takes --print, for when the token should not land in a browser history entry", () => {
    expect(parseCliArgs(["--print"]).print).toBe(true);
  });

  it("takes --help, and -h", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("refuses an unknown flag rather than launching something unasked for", () => {
    expect(() => parseCliArgs(["--worktree"])).toThrow(/unknown option: --worktree/);
  });

  it("refuses a bare argument, since the command takes none", () => {
    expect(() => parseCliArgs(["RIC-1"])).toThrow(/unexpected argument: RIC-1/);
  });

  it("refuses --model with nothing after it", () => {
    expect(() => parseCliArgs(["--model"])).toThrow(/--model needs a value/);
  });

  it("refuses an effort the launch API would answer 422 to", () => {
    expect(() => parseCliArgs(["--effort", "turbo"])).toThrow(/--effort must be one of/);
  });
});

describe("parseCliArgs --browser", () => {
  it("takes --browser, for deliberately bypassing the installed web app", () => {
    expect(parseCliArgs(["--browser"]).browser).toBe(true);
  });

  it("defaults to preferring the web app", () => {
    expect(parseCliArgs([]).browser).toBe(false);
  });
});
