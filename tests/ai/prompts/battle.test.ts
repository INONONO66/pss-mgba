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

    expect(context).toContain("super-effective");
    expect(context).toContain("PP");
    expect(context).toContain("Potion");
    expect(context).toContain("Poke Ball");
    expect(context).toContain("CATCHING WILD POKEMON");

    expect(context).not.toContain("raw");
  });
});
