import { describe, expect, it } from "vitest";
import { CREATE_TICKET_SYSTEM, buildCreateTicketMessage } from "../../src/tasks/createTicket";

const input = { teamKey: "RIC", project: "Web", note: "il bottone salva non va", imageUrls: [] as string[] };

type Block = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };
const blocks = (m: ReturnType<typeof buildCreateTicketMessage>) => m.message.content as Block[];
const text = (m: ReturnType<typeof buildCreateTicketMessage>) =>
  blocks(m)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

describe("buildCreateTicketMessage", () => {
  it("is a top-level user message carrying the note, team and project", () => {
    const m = buildCreateTicketMessage(input, []);
    expect(m.type).toBe("user");
    expect(m.parent_tool_use_id).toBeNull();
    expect(m.message.role).toBe("user");
    expect(text(m)).toContain("il bottone salva non va");
    expect(text(m)).toContain("RIC");
    expect(text(m)).toContain("Web");
  });

  it("says nothing about images when there are none", () => {
    const m = buildCreateTicketMessage(input, []);
    expect(text(m)).not.toContain("![](");
    expect(text(m).toLowerCase()).not.toContain("immagini");
    expect(blocks(m).some((b) => b.type === "image")).toBe(false);
  });

  it("embeds every url and attaches every image as a base64 block", () => {
    const urls = ["https://uploads.linear.app/a.png", "https://uploads.linear.app/b.jpg"];
    const m = buildCreateTicketMessage({ ...input, imageUrls: urls }, [
      { mediaType: "image/png", base64: "AAA" },
      { mediaType: "image/jpeg", base64: "BBB" },
    ]);
    expect(text(m)).toContain(`![](${urls[0]})`);
    expect(text(m)).toContain(`![](${urls[1]})`);
    const images = blocks(m).filter((b) => b.type === "image");
    expect(images).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBB" } },
    ]);
  });
});

describe("CREATE_TICKET_SYSTEM", () => {
  it("never asks questions, and names its own tools rather than a Linear MCP", () => {
    expect(CREATE_TICKET_SYSTEM).toContain("Non fare domande: se la nota è vaga, crea un ticket fedele a ciò che dice.");
    expect(CREATE_TICKET_SYSTEM).not.toContain("ask in this terminal");
    expect(CREATE_TICKET_SYSTEM).toContain("create_issue");
    expect(CREATE_TICKET_SYSTEM).toContain("list_labels");
    expect(CREATE_TICKET_SYSTEM).not.toContain("{{");
  });

  it("keeps the intake rules: Italian copy, at most one of the three labels, nothing about priority", () => {
    expect(CREATE_TICKET_SYSTEM).toContain("Italian");
    for (const l of ["`Bug`", "`Improvement`", "`Feature`"]) expect(CREATE_TICKET_SYSTEM).toContain(l);
    expect(CREATE_TICKET_SYSTEM.toLowerCase()).not.toContain("priorit");
  });

  it("carries no image paragraph: that belongs to the message, and only with images", () => {
    expect(CREATE_TICKET_SYSTEM).not.toContain("![](");
  });
});
