// The project folder picker (RIC-585): a folder's subfolders on the server's disk.

/** One subfolder; `git` = it holds a `.git` entry (a repo, or a worktree's `.git` file). */
export interface DirEntry {
  name: string;
  git: boolean;
}

/** A folder's subfolders, sorted by name; `parent` is null at `/`; `home` is the server's HOME. */
export interface DirList {
  path: string;
  parent: string | null;
  home: string;
  dirs: DirEntry[];
}
