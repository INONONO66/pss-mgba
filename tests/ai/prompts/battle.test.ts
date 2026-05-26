import { describe, expect, it } from "vitest";
import { buildBattleContext } from "../../../src/ai/prompts/battle.js";

describe("buildBattleContext", () => {
  it("renders battle commands and strategy without raw", () => {
    const context = buildBattleContext();

    expect(context).toContain("battle(action)");
    expect(context).toContain("fight(move)");
    expect(context).toContain("item(item)");
    expect(context).toContain("switch(pokemon)");
    expect(context).toContain("run");

    expect(context).toContain("Prefer super-effective");
    expect(context).toContain("Check PP");
    expect(context).toContain("Use potions if HP < 25%");
    expect(context).toContain("Wild: run");
    expect(context).toContain("Trainer: must win");

    expect(context).not.toContain("raw");
  });
});
