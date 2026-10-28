import { describe, expect, it } from "vitest";
import { buildTicketPrompt } from "../../src/sessions/prompt";

describe("buildTicketPrompt", () => {
  it("is the exact text without brainstorming", () => {
    expect(buildTicketPrompt("RIC-123", false)).toBe(
      'Leggi il ticket RIC-123 da Linear ed eseguilo.\nQuando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.');
  });

  it("is the exact text with brainstorming", () => {
    expect(buildTicketPrompt("RIC-123", true)).toBe(
      'Leggi il ticket RIC-123 da Linear ed eseguilo.\nPrima di implementare, usa la skill superpowers:brainstorming.\nQuando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.');
  });
});
