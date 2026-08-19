import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * The rough note a human typed into the New-ticket sheet, handed to the intake session
 * that turns it into a real Linear issue. Not a launch context: there is no ticket yet,
 * which is the whole point of the session that reads this.
 */
export interface TicketDraft {
  // Raw, unedited — typos and all. The session rewrites it; Mojito never touches it.
  brief: string;
  teamKey: string;
  projectName: string | null;
  // Already uploaded to Linear by Mojito (the API key is server-side only), so the
  // session has nothing to upload and only has to embed them.
  imageUrls: string[];
}

/**
 * Write a draft and return its path, which the intake prompt embeds. The file is named
 * after nothing in particular: a draft belongs to no ticket and no session id yet, and
 * two drafts can be in flight at once, so a random name is what keeps them apart.
 */
export function writeTicketDraft(stateDir: string, draft: TicketDraft): string {
  const dir = join(stateDir, "drafts");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomBytes(6).toString("hex")}.json`);
  writeFileSync(path, JSON.stringify(draft, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600); // mode on writeFileSync is ignored if the file pre-existed
  return path;
}
