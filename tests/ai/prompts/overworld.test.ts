import { describe, expect, it } from "vitest";
import { buildOverworldContext } from "../../../src/ai/prompts/overworld.js";

describe("buildOverworldContext", () => {
  it("renders overworld commands and strategy without raw", () => {
    const context = buildOverworldContext();

    expect(context).toContain("navigate(x, y)");
    expect(context).toContain("interact(direction?)");
    expect(context).toContain("wait(frames)");

    expect(context).toContain("warp tiles (W)");
    expect(context).toContain("Talk to NPCs");
    expect(context).toContain("retry same target");
    expect(context).toContain("map graph");
    expect(context).toContain("POKEMON CENTER");
    expect(context).toContain("POKE MART");

    expect(context).not.toContain("raw");
  });
});
