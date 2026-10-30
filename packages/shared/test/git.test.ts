import { describe, expect, it } from "vitest";
import { isValidHash, isValidTicket } from "../src/index";

describe("isValidHash", () => {
  it("accepts 7 to 40 lowercase hex digits", () => {
    expect(isValidHash("deadbee")).toBe(true);
    expect(isValidHash("a".repeat(40))).toBe(true);
  });

  it("rejects short, long, uppercase and non-hex values", () => {
    for (const bad of ["abc123", "a".repeat(41), "DEADBEEF", "deadbeeg", "", "HEAD", "--all", "deadbeef\n"]) {
      expect(isValidHash(bad), bad).toBe(false);
    }
  });
});

describe("isValidTicket", () => {
  it("accepts a team key and a number", () => {
    expect(isValidTicket("RIC-505")).toBe(true);
    expect(isValidTicket("ab2-1")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["RIC", "RIC-", "-12", "2RIC-1", "RIC-1a", "RIC-1; rm", "RIC-1\n", ""]) {
      expect(isValidTicket(bad), bad).toBe(false);
    }
  });
});
