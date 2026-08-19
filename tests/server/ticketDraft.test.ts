import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeTicketDraft } from "@/server/ticketDraft";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-draft-")); });

const draft = {
  brief: "il bottone di logut non fa niente su mobile",
  teamKey: "RIC",
  projectName: "Mojito",
  imageUrls: ["https://uploads.linear.app/a.png"],
};

describe("writeTicketDraft", () => {
  it("writes the draft as JSON under the state dir's drafts folder", () => {
    const path = writeTicketDraft(dir, draft);
    expect(dirname(path)).toBe(join(dir, "drafts"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(draft);
  });

  it("keeps the draft private to the owner", () => {
    const path = writeTicketDraft(dir, draft);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "drafts")).mode & 0o777).toBe(0o700);
  });

  // Two tickets can be drafted at once; the second must not overwrite the first's file
  // out from under a session that has not read it yet.
  it("gives every draft its own file", () => {
    expect(writeTicketDraft(dir, draft)).not.toBe(writeTicketDraft(dir, draft));
  });
});
