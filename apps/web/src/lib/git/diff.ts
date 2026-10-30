// A unified patch as classified lines; the sheet colours them.

export type DiffLineKind = "add" | "del" | "hunk" | "ctx" | "note";

const kindOf = (line: string): DiffLineKind => {
  if (line.startsWith("@@")) return "hunk";
  switch (line[0]) {
    case "+":
      return "add";
    case "-":
      return "del";
    case "\\":
      return "note";
    default:
      return "ctx";
  }
};

export function diffLines(patch: string): { kind: DiffLineKind; text: string }[] {
  if (patch === "") return [];
  const lines = patch.split("\n");
  // A patch ends with a newline: the split's empty tail is not a line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((text) => ({ kind: kindOf(text), text }));
}
