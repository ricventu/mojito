import init from "./001_init";

export interface Migration {
  version: number;
  sql: string;
}

// Ordered by version; append only — an applied migration is never edited.
export const migrations: Migration[] = [{ version: 1, sql: init }];
