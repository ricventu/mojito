import init from "./001_init";
import dropBrainstorming from "./002_drop_brainstorming";
import sessionHidden from "./003_session_hidden";
import sessionTitle from "./004_session_title";

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
];
