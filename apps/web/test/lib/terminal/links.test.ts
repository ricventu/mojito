import { describe, it, expect } from "vitest";
import { cellOfChar, findLinks, MAX_CHARS, type CellLine } from "@/lib/terminal/links";

/**
 * A 49-column phone pane running claude's MCP auth prompt, rows verbatim from
 * `tmux capture-pane -p`: a 2-cell indent and a 2-cell right margin, so bodies are 45 wide
 * and never reach the last column.
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

/** claude's bullet: `● ` in the first row's margin, two spaces on the rows continuing it. */
const MR_URL = "https://gitlab.com/factorybook/GestionaleCooperativeMvp/-/merge_requests/6";
const BULLET_PANE = [
  "● --description prende una stringa, non un file.",
  "",
  "  Ran 1 shell command",
  "",
  "● MR aperta: https://gitlab.com/factorybook/Gesti",
  "  onaleCooperativeMvp/-/merge_requests/6",
  "",
  "  Worktree conservato — è lì che si itera sui",
  "  feedback della MR. Allineo Linear allo stato",
];

/** Rows as xterm hands them out: space-padded to the terminal width. */
const linksAt = (rows: string[], cols: number, row: number) =>
  findLinks(row, (i) => rows[i]?.padEnd(cols, " "), cols);
const textsAt = (rows: string[], cols: number, row: number) => linksAt(rows, cols, row).map((l) => l.text);
/** With doc paths on, as a terminal whose session has a project. */
const docsAt = (rows: string[], cols: number, row: number) =>
  findLinks(row, (i) => rows[i]?.padEnd(cols, " "), cols, { docs: true }).map((l) => [l.kind, l.text]);

describe("findLinks", () => {
  it("joins a URL claude wrapped inside its own margins", () => {
    const links = linksAt(AUTH_PANE, PHONE_COLS, 5);
    expect(links).toEqual([{ kind: "url", text: AUTH_URL, start: { row: 5, char: 2 }, end: { row: 8, char: 5 } }]);
  });

  it("reports the link from every row it spans, so each of them is clickable", () => {
    for (const row of [6, 7, 8]) {
      const links = linksAt(AUTH_PANE, PHONE_COLS, row);
      expect(links.map((l) => [l.text, l.start])).toEqual([[AUTH_URL, { row: 5, char: 2 }]]);
    }
  });

  it("joins a URL wrapped under a bullet, whose marker fills the first row's margin", () => {
    for (const row of [4, 5]) {
      expect(linksAt(BULLET_PANE, PHONE_COLS, row)).toEqual([
        { kind: "url", text: MR_URL, start: { row: 4, char: 13 }, end: { row: 5, char: 39 } },
      ]);
    }
  });

  it("leaves the prose around a wrapped URL alone", () => {
    for (const row of [0, 1, 2, 3, 4, 9, 10]) expect(linksAt(AUTH_PANE, PHONE_COLS, row)).toEqual([]);
    for (const row of [0, 1, 2, 3, 6, 7, 8]) expect(linksAt(BULLET_PANE, PHONE_COLS, row)).toEqual([]);
  });

  it("does not join a bullet onto the block above it", () => {
    // Joined, the URL above would read `…/here/abnext` and claim the bullet's row too.
    const rows = ["  see https://example.com/some/long/path/here/ab", "● next item", "  continues"];
    expect(textsAt(rows, PHONE_COLS, 0)).toEqual(["https://example.com/some/long/path/here/ab"]);
    expect(textsAt(rows, PHONE_COLS, 1)).toEqual([]);
  });

  it("joins rows wrapped flush to the last column", () => {
    const cols = 46;
    const rows = [
      "https://claude.ai/api/organizations/02960d4e-e",
      "57a-4499-8561-5c5199aa6328/mcp/start-auth/mcps",
      "rv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface=cl",
      "i",
    ];
    for (const row of [0, 1, 2, 3]) expect(textsAt(rows, cols, row)).toEqual([AUTH_URL]);
  });

  it("finds a URL that fits on one row", () => {
    expect(linksAt(["see https://example.com/docs for more"], PHONE_COLS, 0)).toEqual([
      { kind: "url", text: "https://example.com/docs", start: { row: 0, char: 4 }, end: { row: 0, char: 27 } },
    ]);
  });

  it("does not glue the row below onto a URL that ends short of the wrap width", () => {
    const rows = ["  Docs: https://example.com/a/b/c", "  then some other text"];
    expect(textsAt(rows, PHONE_COLS, 0)).toEqual(["https://example.com/a/b/c"]);
    expect(textsAt(rows, PHONE_COLS, 1)).toEqual([]);
  });

  it("keeps a wrapped block joined when a differently indented row follows", () => {
    const rows = ["  https://example.com/a/very/long/path/that-w", "  raps-once-more", "      then an indented note"];
    expect(textsAt(rows, PHONE_COLS, 1)).toEqual(["https://example.com/a/very/long/path/that-wraps-once-more"]);
  });

  it("stops at a blank inside a joined row", () => {
    const rows = ["  https://example.com/a/very/long/path/that-e", "  nds-here and then prose"];
    expect(textsAt(rows, PHONE_COLS, 0)).toEqual(["https://example.com/a/very/long/path/that-ends-here"]);
  });

  it("only reports the URLs crossing the asked row", () => {
    const cols = 30;
    const rows = ["https://a.example/x and also h", "ttps://b.example/y"];
    expect(textsAt(rows, cols, 0)).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(textsAt(rows, cols, 1)).toEqual(["https://b.example/y"]);
  });

  it("ignores non-URLs, other schemes and rows past the end of the buffer", () => {
    expect(linksAt(["no links here, javascript:alert(1)"], PHONE_COLS, 0)).toEqual([]);
    expect(linksAt(["https://:"], PHONE_COLS, 0)).toEqual([]);
    expect(linksAt(AUTH_PANE, PHONE_COLS, 11)).toEqual([]);
  });

  it("caps how far it joins, so a dense screen cannot run away", () => {
    const cols = 46;
    const dense = Array.from({ length: 200 }, () => "x".repeat(cols));
    dense[0] = "https://example.com/" + "y".repeat(cols - 20);
    const links = linksAt(dense, cols, 0);
    expect(links).toHaveLength(1);
    expect(links[0].text.length).toBeLessThanOrEqual(MAX_CHARS);
  });
});

/** A row of cells: a string per cell, "" for the second half of a wide character. */
function line(cells: string[]): CellLine {
  return {
    length: cells.length,
    getCell: (x: number) =>
      ({ getChars: () => cells[x], getWidth: () => (cells[x] === "" ? 0 : 1) }) as ReturnType<CellLine["getCell"]>,
  };
}

describe("cellOfChar", () => {
  it("is the identity on a row of narrow characters", () => {
    expect(cellOfChar(line(["a", "b", "c"]), 2)).toBe(2);
  });

  it("skips the empty second cell of a wide character", () => {
    // "界" takes cells 0-1 and is one character of the string, so "h" (char 1) sits in cell 2.
    expect(cellOfChar(line(["界", "", "h"]), 1)).toBe(2);
  });

  it("counts every character of a cell carrying a combining mark", () => {
    // "é" is two characters in one cell: char 2 is the next cell.
    expect(cellOfChar(line(["é", "x"]), 2)).toBe(1);
  });
});

describe("findLinks: markdown paths", () => {
  const one = (line: string) => docsAt([line], PHONE_COLS, 0);

  it("finds the path inside claude's tool call", () => {
    expect(one("● Write(docs/superpowers/specs/x.md)")).toEqual([["doc", "docs/superpowers/specs/x.md"]]);
  });

  it("leaves out backticks, a line suffix and a full stop", () => {
    expect(one("Spec at `docs/a.md`.")).toEqual([["doc", "docs/a.md"]]);
    expect(one("see docs/a.md:12 there")).toEqual([["doc", "docs/a.md"]]);
    expect(one("Read README.md.")).toEqual([["doc", "README.md"]]);
  });

  it("takes ~/, absolute and ./ paths, dropping the ./", () => {
    expect(one("at ~/notes/x.md")).toEqual([["doc", "~/notes/x.md"]]);
    expect(one("at /home/me/r/X.MD")).toEqual([["doc", "/home/me/r/X.MD"]]);
    expect(one("at ./x.md")).toEqual([["doc", "x.md"]]);
  });

  it("takes accented names whole", () => {
    expect(one("at docs/spec-perché.md now")).toEqual([["doc", "docs/spec-perché.md"]]);
    expect(one("at docs/perché-spec.md")).toEqual([["doc", "docs/perché-spec.md"]]);
  });

  it("drops the @ of a mention, linking the path only", () => {
    expect(docsAt(["> read @docs/x.md please"], PHONE_COLS, 0)).toEqual([["doc", "docs/x.md"]]);
    const [link] = findLinks(0, () => "> read @docs/x.md please".padEnd(PHONE_COLS), PHONE_COLS, { docs: true });
    expect(link?.start).toEqual({ row: 0, char: 8 });
  });

  it("is no link with a .. segment, another extension or glued to a word", () => {
    expect(one("at ../x.md")).toEqual([]);
    expect(one("at docs/../x.md")).toEqual([]);
    expect(one("at a/b.mdx")).toEqual([]);
    expect(one("at a/b.md/c")).toEqual([]);
  });

  it("joins a path claude wrapped inside its margins", () => {
    const rows = ["  Spec at docs/superpowers/specs/2026-10-30-d", "  ocs-viewer-design.md and the plan next."];
    const path = "docs/superpowers/specs/2026-10-30-docs-viewer-design.md";
    for (const row of [0, 1]) expect(docsAt(rows, PHONE_COLS, row)).toEqual([["doc", path]]);
  });

  it("keeps a URL ending in .md a URL", () => {
    expect(one("see https://github.com/o/r/blob/main/README.md now")).toEqual([
      ["url", "https://github.com/o/r/blob/main/README.md"],
    ]);
  });

  it("finds both kinds on one row", () => {
    expect(one("docs/a.md and https://x.io")).toEqual([
      ["url", "https://x.io"],
      ["doc", "docs/a.md"],
    ]);
  });

  it("offers no doc links unless asked", () => {
    expect(linksAt(["● Write(docs/superpowers/specs/x.md)"], PHONE_COLS, 0)).toEqual([]);
  });
});
