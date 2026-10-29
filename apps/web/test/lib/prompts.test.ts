import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS } from "@mojito/shared";
import { promptErrors } from "@/lib/prompts";

describe("promptErrors", () => {
  it("has nothing to say about the defaults", () => {
    expect(promptErrors(DEFAULT_PROMPTS)).toEqual({});
  });

  it("names the prompt that is wrong, and only that one", () => {
    expect(promptErrors({ ...DEFAULT_PROMPTS, ticket: "Do the ticket." })).toEqual({
      ticket: "Must contain {ticket}, where the ticket id goes.",
    });
    expect(promptErrors({ ticket: "{ticket}", createTicket: " \n" })).toEqual({ createTicket: "Must not be empty." });
  });
});
