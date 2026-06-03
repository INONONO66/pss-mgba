import { describe, expect, it } from "vitest";
import { buildOverworldContext } from "../../../src/ai/prompts/overworld.js";

describe("buildOverworldContext", () => {
  it("renders overworld commands and strategy without raw", () => {
    const context = buildOverworldContext();

    expect(context).toContain("navigate(x, y)");
    expect(context).toContain("interact(direction?)");
    expect(context).toContain("wait(frames)");

    expect(context).toContain("Warp tiles (W on the map)");
    expect(context).toContain("<exploration>");
    expect(context).toContain("<shopping_and_healing>");

    expect(context).not.toContain("raw");
  });
});
