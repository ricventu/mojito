import { describe, expect, it } from "vitest";
import type { Settings, TicketSummary } from "@mojito/shared";
import { ApiError } from "@/lib/api";
import { initialLaunchOptions, launchErrorAction } from "@/lib/launch";

const settings: Settings = {
  statusDefaults: { Todo: { model: "sonnet", effort: "medium" } },
};

function ticket(statusName: string): TicketSummary {
  return {
    identifier: "RIC-1",
    title: "t",
    url: "https://linear.app/x/issue/RIC-1",
    statusName,
    statusType: "unstarted",
    project: "Alpha",
    labels: [],
    assignedToMe: false,
  };
}

describe("initialLaunchOptions", () => {
  it("uses the status default when there is one", () => {
    expect(initialLaunchOptions(ticket("Todo"), settings)).toEqual({
      model: "sonnet",
      effort: "medium",
    });
  });

  it("falls back to opus/high for an unknown status", () => {
    expect(initialLaunchOptions(ticket("Weird"), settings)).toEqual({
      model: "opus",
      effort: "high",
    });
  });
});

describe("launchErrorAction", () => {
  it("opens the live session on a 409 that names it", () => {
    const err = new ApiError(409, "already live", { error: "already live", sessionId: "mj-RIC-1" });
    expect(launchErrorAction(err)).toEqual({ kind: "open", sessionId: "mj-RIC-1" });
  });

  it("toasts the message on a 409 without a session id", () => {
    expect(launchErrorAction(new ApiError(409, "occupato", { error: "occupato" }))).toEqual({
      kind: "toast",
      message: "occupato",
    });
  });

  it("toasts the message on a 400", () => {
    expect(launchErrorAction(new ApiError(400, "project path not found: /x", undefined))).toEqual({
      kind: "toast",
      message: "project path not found: /x",
    });
  });
});
