import { readFileSync } from "node:fs";

/**
 * Claude Code's current session title, read from its transcript. CC writes the
 * auto-generated (or `/rename`'d) title into the transcript as a JSONL line
 * `{"type":"custom-title","customTitle":"…"}`; the latest such line wins, since
 * CC re-titles a session as it learns what it's about. Returns null when the
 * file is unreadable or holds no titled line yet.
 *
 * The hook input's own `session_title` field only carries a title set via
 * `--name` / `/rename`, and only on SessionStart — empty for a fresh session
 * (see hook/route.ts). The transcript is the only source of CC's auto title.
 * That shape is undocumented, so this fails soft (null) on any surprise rather
 * than throwing into the hook path.
 */
export function readTranscriptTitle(transcriptPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null; // transcript not written yet, or path gone
  }
  let title: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.includes('"custom-title"')) continue; // cheap prefilter before JSON.parse
    try {
      const o = JSON.parse(line) as { type?: unknown; customTitle?: unknown };
      if (o.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle.length > 0) {
        title = o.customTitle;
      }
    } catch {
      /* skip a malformed line */
    }
  }
  return title;
}
