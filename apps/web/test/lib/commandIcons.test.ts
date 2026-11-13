import { COMMAND_ICONS } from "@mojito/shared";
import { describe, expect, it } from "vitest";
import { COMMAND_ICON_COMPONENTS } from "../../src/lib/commandIcons";

describe("COMMAND_ICON_COMPONENTS", () => {
  it("has a component for every command icon", () => {
    for (const name of COMMAND_ICONS) expect(COMMAND_ICON_COMPONENTS[name], name).toBeTruthy();
    expect(Object.keys(COMMAND_ICON_COMPONENTS).sort()).toEqual([...COMMAND_ICONS].sort());
  });
});
