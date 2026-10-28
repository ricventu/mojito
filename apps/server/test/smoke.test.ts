import { describe, it, expect } from "vitest";
import * as shared from "@mojito/shared";

describe("workspace", () => {
  it("resolves @mojito/shared from the server package", () => {
    expect(shared).toBeDefined();
    expect(true).toBe(true);
  });
});
