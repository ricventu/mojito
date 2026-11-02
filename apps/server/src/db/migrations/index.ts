import init from "./001_init";
import dropBrainstorming from "./002_drop_brainstorming";
import sessionHidden from "./003_session_hidden";
import sessionTitle from "./004_session_title";
import dropSessionHidden from "./005_drop_session_hidden";
import sessionEndReason from "./006_session_end_reason";
import sessionClaudeId from "./007_session_claude_id";

export interface Migration {
  version: number;
  sql: string;
}

// Ordered by version; append only — an applied migration is never edited.
export const migrations: Migration[] = [
  { version: 1, sql: init },
  { version: 2, sql: dropBrainstorming },
  { version: 3, sql: sessionHidden },
  { version: 4, sql: sessionTitle },
  { version: 5, sql: dropSessionHidden },
  { version: 6, sql: sessionEndReason },
  { version: 7, sql: sessionClaudeId },
];
