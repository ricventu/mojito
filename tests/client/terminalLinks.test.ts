import { describe, it, expect } from "vitest";
import { findTerminalLinks, MAX_JOINED_CHARS } from "@/lib/terminalLinks";

/**
 * The pane the bug was reported from: a 49-column phone terminal running
 * claude's MCP auth prompt. Rows are verbatim from `tmux capture-pane -p` on
 * the live session, so the 2-cell indent and the 2-cell right margin (bodies of
 * 45 in a 49-column pane, never reaching the last column) are the real ones.
 */
const PHONE_COLS = 49;
const AUTH_URL =
  "https://claude.ai/api/organizations/02960d4e-e57a-4499-8561-5c5199aa6328/mcp/start-auth/mcpsrv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface=cli";
const AUTH_PANE = [
  "  *  A browser window will open for",
  "    authentication",
  "  If your browser doesn't open        (c to",
  "  automatically, copy this URL        copy)",
  "  manually",
  "  https://claude.ai/api/organizations/02960d4e-",
  "  e57a-4499-8561-5c5199aa6328/mcp/start-auth/mc",
  "  psrv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface",
  "  =cli",
  "     Press Enter after authenticating in your",
  "     browser.",
];

/** Rows as xterm hands them out: space-padded to the terminal width. */
const reader = (rows: string[], cols: number) => (index: number) =>
  rows[index] === undefined ? undefined : rows[index].padEnd(cols, " ");

const linksAt = (rows: string[], cols: number, row: number) =>
  findTerminalLinks(row, reader(rows, cols), cols);

describe("findTerminalLinks", () => {
  it("joins the URL claude wrapped inside its own margins", () => {
    const links = linksAt(AUTH_PANE, PHONE_COLS, 5);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe(AUTH_URL);
    // Column 2 on both ends: the block's indent, put back on.
    expect(links[0].start).toEqual({ row: 5, char: 2 });
    expect(links[0].end).toEqual({ row: 8, char: 5 });
  });

  it("reports the same link from every row it spans, so all of them are clickable", () => {
    for (const row of [6, 7, 8]) {
      const links = linksAt(AUTH_PANE, PHONE_COLS, row);
      expect(links.map((l) => l.text)).toEqual([AUTH_URL]);
      expect(links[0].start).toEqual({ row: 5, char: 2 });
    }
  });

  it("leaves the prose above the URL alone", () => {
    for (const row of [0, 1, 2, 3, 4, 9, 10]) {
      expect(linksAt(AUTH_PANE, PHONE_COLS, row)).toEqual([]);
    }
  });

  it("joins rows a terminal hard-wrapped flush to the last column", () => {
    const cols = 46;
    const rows = [
      "https://claude.ai/api/organizations/02960d4e-e",
      "57a-4499-8561-5c5199aa6328/mcp/start-auth/mcps",
      "rv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface=cl",
      "i",
    ];
    for (const row of [0, 1, 2, 3]) {
      expect(linksAt(rows, cols, row).map((l) => l.text)).toEqual([AUTH_URL]);
    }
  });

  it("finds a URL that fits on one row", () => {
    const rows = ["see https://example.com/docs for more"];
    const links = linksAt(rows, PHONE_COLS, 0);
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("https://example.com/docs");
    expect(links[0].start).toEqual({ row: 0, char: 4 });
    expect(links[0].end).toEqual({ row: 0, char: 27 });
  });

  it("does not glue the row below onto a URL that ends far from the wrap width", () => {
    const rows = ["  Docs: https://example.com/a/b/c", "  then some other text"];
    expect(linksAt(rows, PHONE_COLS, 0).map((l) => l.text))
      .toEqual(["https://example.com/a/b/c"]);
  });

  it("keeps a wrapped block joined when a differently indented row follows", () => {
    const rows = [
      "  https://example.com/a/very/long/path/that-w",
      "  raps-once-more",
      "      then an indented note",
    ];
    expect(linksAt(rows, PHONE_COLS, 1).map((l) => l.text))
      .toEqual(["https://example.com/a/very/long/path/that-wraps-once-more"]);
  });

  it("stops at a blank cell inside a joined row", () => {
    const rows = [
      "  https://example.com/a/very/long/path/that-e",
      "  nds-here and then prose",
    ];
    expect(linksAt(rows, PHONE_COLS, 0).map((l) => l.text))
      .toEqual(["https://example.com/a/very/long/path/that-ends-here"]);
  });

  it("ignores non-URL text and rows past the end of the buffer", () => {
    expect(linksAt(["no links here"], PHONE_COLS, 0)).toEqual([]);
    expect(linksAt(AUTH_PANE, PHONE_COLS, 11)).toEqual([]);
  });

  it("caps how far it will join so a dense screen cannot run away", () => {
    const cols = 46;
    const dense = Array.from({ length: 200 }, () => "x".repeat(cols));
    dense[0] = "https://example.com/" + "y".repeat(cols - 20);
    const links = linksAt(dense, cols, 0);
    expect(links).toHaveLength(1);
    expect(links[0].text.length).toBeLessThanOrEqual(MAX_JOINED_CHARS);
  });
});
