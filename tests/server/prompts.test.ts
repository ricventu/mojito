import { describe, it, expect } from "vitest";
import { buildWorkPrompt, buildMergeFixPrompt, buildIntakePrompt } from "@/server/prompts";

const vars = { ticket: "RIC-46", contextPath: "/state/context/s1.json", resultPath: "/state/results/s1.json", hasAssets: true };
const { hasAssets: _hasAssets, ...baseVars } = vars;
const fixVars = { ...baseVars, mergeMode: "local" as const, blocker: "CONFLICT (content): src/a.ts" };

// The prompts are hard-wrapped prose; assert on them without coupling to line breaks.
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("prompt builder", () => {
  it("interpolates all placeholders in the work prompt", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("/state/context/s1.json");
    expect(p).toContain("/state/results/s1.json");
    expect(p).not.toContain("{{");
  });
  it("interpolates all placeholders in the merge-fix prompt, including the blocker", () => {
    const p = buildMergeFixPrompt(fixVars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("CONFLICT (content): src/a.ts");
    expect(p).not.toContain("{{");
  });
  // RIC-184. Neither prompt tells the session anything about how it may use Linear, in
  // either direction, and both wrong answers have already shipped once: the original
  // blanket ban killed the follow-up tickets that surface mid-session, and the permission
  // grant that replaced it had the session opening tickets without asking. With no
  // instruction at all the session behaves like any other — it proposes, the user
  // confirms. This test fails on either polarity creeping back.
  it("gives neither prompt any instruction about using Linear", () => {
    const banned = [
      // Prohibitions.
      "never use any linear",
      "mojito manages linear for you",
      "linear perimeter",
      "never transition",
      "read-only",
      "sub-issue",
      // Permissions.
      "without asking",
      "file a new issue",
      "creating new linear issues",
      "is allowed and expected",
      "linear is yours to use",
    ];
    for (const p of [buildWorkPrompt(vars), buildMergeFixPrompt(fixVars)]) {
      const f = flat(p).toLowerCase();
      for (const phrase of banned) expect(f, `prompt should not mention "${phrase}"`).not.toContain(phrase);
    }
  });

  // The blocked-phrase list above only catches wordings someone thought to block. Pinning
  // the mention count is the stronger guard: any new sentence about Linear fails it,
  // however it is phrased. Both prompts, since both have carried a ban.
  it("names Linear only as the source of the data Mojito already read", () => {
    const work = flat(buildWorkPrompt(vars));
    expect(work).toContain("You are working Linear ticket RIC-46 end to end in this repository.");
    expect(work).toContain(
      "Mojito already read all of that from Linear, so you never have to spend tokens re-reading it.",
    );
    expect(work).toContain("because their URLs sit behind Linear's file auth");
    expect(work.match(/Linear/g)).toHaveLength(3);
    // Without assets the paragraph is gone, and with it its single Linear mention.
    expect(flat(buildWorkPrompt({ ...vars, hasAssets: false })).match(/Linear/g)).toHaveLength(2);

    // The merge-fix session gets its ticket data the same way and needs no Linear sentence
    // of its own, so its one mention is the opening line naming the branch's ticket.
    const fix = flat(buildMergeFixPrompt(fixVars));
    expect(fix).toContain("The QA-approved branch for Linear ticket RIC-46 could not be merged");
    expect(fix.match(/Linear/g)).toHaveLength(1);
  });

  it("keeps the result contracts distinct: work reports ready-for-qa, merge-fix reports merged", () => {
    expect(buildWorkPrompt(vars)).toContain('"ready-for-qa"');
    const fix = buildMergeFixPrompt(fixVars);
    expect(fix).toContain('"merged"');
    expect(fix).not.toContain('"ready-for-qa"');
  });
  it("selects the completion step from the approved merge mode", () => {
    expect(buildMergeFixPrompt(fixVars)).toContain("--ff-only");
    expect(buildMergeFixPrompt(fixVars)).not.toContain("gh pr create");
    const mr = buildMergeFixPrompt({ ...fixVars, mergeMode: "mr" });
    expect(mr).toContain("gh pr create");
    expect(mr).not.toContain("--ff-only");
  });
  it("gives the merge-fix session the same bare result contract", () => {
    const p = buildMergeFixPrompt(fixVars);
    expect(p).toContain('{"outcome": "merged"}');
    expect(p).not.toContain("notes");
    expect(p).not.toContain("blocked");
  });
  it("sanitizes a blocker instead of failing the launch", () => {
    const p = buildMergeFixPrompt({ ...fixVars, blocker: "weird {{TICKET}} output" });
    expect(p).not.toContain("{{");
    const empty = buildMergeFixPrompt({ ...fixVars, blocker: "   " });
    expect(empty).toContain("(no diagnostic output)");
  });

  it("tells the work session to read the assets Mojito downloaded", () => {
    const p = buildWorkPrompt({ ...vars, hasAssets: true });
    expect(p).toContain("localPath");
    expect(p).toContain("Read tool");
    expect(p).toContain("attachments");
  });

  // Most tickets carry nothing. Six lines about files that do not exist are pure cost, and
  // they invite the session to go looking for context keys it does not have.
  it("omits the asset paragraph — and leaves no gap — when there is nothing to read", () => {
    const p = buildWorkPrompt({ ...vars, hasAssets: false });
    expect(p).not.toContain("localPath");
    expect(p).not.toContain("attachments");
    expect(p).not.toContain("\n\n\n");
  });

  // The method is the session's business; the prompt carries only what a session cannot infer.
  // That includes whether the work is worth a branch of its own — a one-line fix is not, and
  // the QA gate answers "nothing to merge" for a ticket that never took one.
  it("carries no rework branch, no blocked outcome, no notes field, and no worktree rule", () => {
    const p = buildWorkPrompt(vars);
    expect(p).not.toContain("rejectReason");
    expect(p).not.toContain("blocked");
    expect(p).not.toContain("notes");
    expect(p).not.toContain("worktree");
  });

  it("leaves the merge-fix prompt free of the asset paragraph", () => {
    expect(buildMergeFixPrompt(fixVars)).not.toContain("localPath");
  });
});

const intakeVars = {
  draftPath: "/state/drafts/ab12cd.json", teamKey: "RIC", projectName: "Mojito", hasImages: true,
};

// The intake session is the one session Mojito spawns that writes Linear itself: it exists
// to create the issue, so there is no ticket for Mojito to create on its behalf and no
// result file to report through. That makes it the deliberate exception to RIC-184's
// silence — an exception scoped to this prompt alone, which is why the guards above run
// over the work and merge-fix prompts only.
describe("intake prompt", () => {
  it("interpolates the draft path, the team and the project", () => {
    const p = buildIntakePrompt(intakeVars);
    expect(p).toContain("/state/drafts/ab12cd.json");
    expect(p).toContain("RIC");
    expect(p).toContain("Mojito");
    expect(p).not.toContain("{{");
  });

  // "General" in the sheet means the ticket belongs to a team but to no project. The
  // session must be told that plainly, or it invents one to fill the blank.
  it("says the issue has no project when the draft carries none", () => {
    const p = flat(buildIntakePrompt({ ...intakeVars, projectName: null }));
    expect(p).toContain("no project");
    expect(p).not.toContain("{{");
  });

  it("asks for the ticket copy in Italian", () => {
    expect(flat(buildIntakePrompt(intakeVars))).toContain("in Italian");
  });

  it("has the session create the issue itself through the Linear MCP", () => {
    const p = flat(buildIntakePrompt(intakeVars));
    expect(p).toContain("Linear MCP");
    expect(p).not.toContain("outcome"); // no result file: creating the issue IS the outcome
  });

  // The images are already on Linear (the API key is server-side), so the session embeds
  // rather than uploads — telling it otherwise sends it looking for local files.
  it("tells the session the images are already uploaded", () => {
    const p = flat(buildIntakePrompt(intakeVars));
    expect(p).toContain("imageUrls");
    expect(p).toContain("![](url)");
  });

  // RIC-223. A note with no images gets no images paragraph at all: the draft's
  // `imageUrls` is an empty array, and a session told to embed them either hunts for
  // something that is not there or leaves an empty attachments heading in the ticket.
  it("drops the images paragraph when the note carries none", () => {
    const p = flat(buildIntakePrompt({ ...intakeVars, hasImages: false }));
    expect(p).not.toContain("imageUrls");
    expect(p).not.toContain("![](url)");
    expect(p).not.toContain("{{");
    // The draft is still read — only the images half of it goes away.
    expect(p).toContain("/state/drafts/ab12cd.json");
    expect(p).toContain("brief");
  });

  // RIC-223. What the ticket *is* belongs in a label, not in a heading that repeats it.
  // The three names are Linear's own, capitalized as the team has them, since the session
  // passes them to the MCP verbatim.
  it("asks for exactly one of the three Linear labels", () => {
    const p = flat(buildIntakePrompt(intakeVars));
    expect(p).toContain("`Bug`");
    expect(p).toContain("`Improvement`");
    expect(p).toContain("`Feature`");
    expect(p).toMatch(/exactly one/);
  });

  it("bans the label's name as a heading in the description", () => {
    expect(flat(buildIntakePrompt(intakeVars))).toMatch(/no .*heading|do not .*heading/);
  });

  // Project names come from projects.json, not from Mojito: a stray "{{" in one is a
  // config typo, and a typo must not leave a live placeholder in the prompt (nor, as the
  // work prompt does, fail the launch — there is no ticket yet to fall back to).
  it("sanitizes a placeholder-looking project name instead of failing", () => {
    const p = buildIntakePrompt({ ...intakeVars, projectName: "{{TEAM_KEY}}" });
    expect(p).not.toContain("{{");
  });
});
