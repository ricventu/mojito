// The git graph of a project's checkout (RIC-505): read-only, one page of commits at a time.

/** A branch or tag name on a commit; `worktree` marks a local branch checked out in a live worktree. */
export interface GraphRef {
  name: string;
  kind: "local" | "remote" | "tag";
  worktree?: true;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  /** Author date, strict ISO 8601. */
  date: string;
  subject: string;
  refs: GraphRef[];
}

/** One branch measured against a base: `ahead`/`behind` are exact whatever part of the log is loaded. */
export interface GraphHighlight {
  branch: string;
  tip: string;
  base: string;
  baseTip: string;
  ahead: number;
  behind: number;
  merged: boolean;
}

/** `highlight` is only set on the first page; `head` is null on an empty repo. */
export interface GitGraphPage {
  head: string | null;
  highlight: GraphHighlight | null;
  commits: GraphCommit[];
  hasMore: boolean;
}

export interface CommitFile {
  status: string;
  path: string;
  /** The old path of a rename or copy. */
  from?: string;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  message: string;
  files: CommitFile[];
  /** Files past the cap that are not listed. */
  moreFiles: number;
}

export interface CommitDiff {
  patch: string;
  binary: boolean;
  truncated: boolean;
}
