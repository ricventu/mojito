import { describe, it, expect } from "vitest";
import { findTerminalLinks, MAX_JOINED_CHARS } from "@/lib/terminalLinks";

const COLS = 46;

/** A buffer row as xterm hands it out: space-padded to the full width. */
const row = (text: string) => text.padEnd(COLS, " ");

/** Reader over a fixed set of rows, mirroring `buffer.active.getLine(i)`. */
const reader = (rows: string[]) => (index: number) => rows[index];

// The exact rows tmux produces for claude's MCP auth prompt at 46 columns
// (verified with `tmux capture-pane -p` on a 46-column pane): the URL is broken
// into four independent rows, none of them soft-wrapped.
const AUTH_URL =
  "https://claude.ai/api/organizations/02960d4e-e57a-4499-8561-5c5199aa6328/mcp/start-auth/mcpsrv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface=cli";
const AUTH_ROWS = [
  row("  automatically, copy this URL"),
  row("manually"),
  "https://claude.ai/api/organizations/02960d4e-e",
  "57a-4499-8561-5c5199aa6328/mcp/start-auth/mcps",
  "rv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface=cl",
  row("i"),
  row(""),
];

describe("findTerminalLinks", () => {
  it("joins a URL tmux broke across rows", () => {
    const links = findTerminalLinks(2, reader(AUTH_ROWS));
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(AUTH_URL);
    expect(links[0].start).toEqual({ row: 2, char: 0 });
    expect(links[0].end).toEqual({ row: 5, char: 0 });
  });

  it("reports the same link from every row it spans, so all of them are clickable", () => {
    for (const y of [3, 4, 5]) {
      const links = findTerminalLinks(y, reader(AUTH_ROWS));
      expect(links.map((l) => l.text)).toEqual([AUTH_URL]);
      expect(links[0].start).toEqual({ row: 2, char: 0 });
    }
  });

  it("finds a URL that fits on one row", () => {
    const rows = [row("see https://example.com/docs for more")];
    const links = findTerminalLinks(0, reader(rows));
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("https://example.com/docs");
    expect(links[0].start).toEqual({ row: 0, char: 4 });
    expect(links[0].end).toEqual({ row: 0, char: 27 });
  });

  it("does not glue on the row below when the row above stopped short of the edge", () => {
    const rows = [row("https://example.com/docs"), row("unrelated/next/line")];
    expect(findTerminalLinks(0, reader(rows)).map((l) => l.text))
      .toEqual(["https://example.com/docs"]);
  });

  it("stops at a blank cell inside a joined row", () => {
    const rows = [
      "open https://example.com/a/very/long/path/tha",
      row("t-ends-here and then prose"),
    ];
    expect(findTerminalLinks(0, reader(rows)).map((l) => l.text))
      .toEqual(["https://example.com/a/very/long/path/that-ends-here"]);
  });

  it("ignores non-URL text and rows past the end of the buffer", () => {
    expect(findTerminalLinks(0, reader([row("no links here")]))).toEqual([]);
    expect(findTerminalLinks(7, reader(AUTH_ROWS))).toEqual([]);
  });

  it("caps how far it will join so a dense screen cannot run away", () => {
    const dense = Array.from({ length: 200 }, () => "x".repeat(COLS));
    dense[0] = "https://example.com/" + "y".repeat(COLS - 20);
    const links = findTerminalLinks(0, reader(dense));
    expect(links).toHaveLength(1);
    expect(links[0].text.length).toBeLessThanOrEqual(MAX_JOINED_CHARS);
  });
});
