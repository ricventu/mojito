import { describe, it, expect } from "vitest";
import { targetQuery, listErrorMessage, docErrorMessage } from "@/lib/useDocs";

describe("targetQuery", () => {
  it("builds a session query", () => {
    expect(targetQuery({ session: "mojito-RIC-162-backlog" })).toBe("session=mojito-RIC-162-backlog");
  });

  it("builds a ticket query with its project", () => {
    expect(targetQuery({ ticket: "RIC-162", project: "Mojito" })).toBe("ticket=RIC-162&project=Mojito");
  });

  it("omits an absent project", () => {
    expect(targetQuery({ ticket: "RIC-162", project: null })).toBe("ticket=RIC-162");
  });

  it("encodes a project name with spaces", () => {
    expect(targetQuery({ ticket: "RIC-1", project: "Factory Book" })).toBe("ticket=RIC-1&project=Factory+Book");
  });
});

describe("listErrorMessage", () => {
  it("names the ticket-with-no-worktree case", () => {
    expect(listErrorMessage(409)).toBe("No worktree for this ticket.");
  });
  it("names the session cases", () => {
    expect(listErrorMessage(404)).toBe("This session is gone.");
    expect(listErrorMessage(400)).toBe("This session has no working directory.");
  });
  it("falls back for anything else", () => {
    expect(listErrorMessage(401)).toBe("Could not load documents.");
    expect(listErrorMessage(500)).toBe("Could not load documents.");
  });
});

describe("docErrorMessage", () => {
  it("covers the document cases from the spec's error table", () => {
    expect(docErrorMessage(404)).toBe("Document not found.");
    expect(docErrorMessage(413)).toBe("Document too large to display.");
    expect(docErrorMessage(400)).toBe("Invalid document path.");
  });
  it("falls back for anything else", () => {
    expect(docErrorMessage(500)).toBe("Could not load the document.");
  });
});
