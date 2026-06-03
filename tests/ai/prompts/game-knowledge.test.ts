import { describe, expect, it } from "vitest";

import { buildGameKnowledge } from "../../../src/ai/prompts/game-knowledge.js";

describe("buildGameKnowledge", () => {
  it("overworld includes full knowledge set", () => {
    const prompt = buildGameKnowledge("overworld");

    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<world_model>");
    expect(prompt).toContain("<stuck_recovery>");
    expect(prompt).toContain("<npc_rules>");
    expect(prompt).toContain("<party_building>");
    expect(prompt).not.toContain("<type_effectiveness>");
  });

  it("battle includes types but omits NPC and stuck", () => {
    const prompt = buildGameKnowledge("battle");

    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<type_effectiveness>");
    expect(prompt).toContain("<party_building>");
    expect(prompt).not.toContain("<npc_rules>");
    expect(prompt).not.toContain("<stuck_recovery>");
  });

  it("dialog includes type chart for move learning but omits NPC, stuck, resources", () => {
    const prompt = buildGameKnowledge("dialog");

    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<type_effectiveness>");
    expect(prompt).not.toContain("<npc_rules>");
    expect(prompt).not.toContain("<stuck_recovery>");
    expect(prompt).not.toContain("<party_building>");
  });

  it("preserves required output rules in all modes", () => {
    for (const mode of ["overworld", "battle", "dialog"] as const) {
      const prompt = buildGameKnowledge(mode);
      expect(prompt).toContain("<constraints>");
      expect(prompt).toContain("<action_plan_format>");
      expect(prompt).toContain("<memory_rules>");
    }
  });

  it("does not include explicit objectives", () => {
    const prompt = buildGameKnowledge("overworld").toLowerCase();

    expect(prompt).not.toContain("go to");
    expect(prompt).not.toContain("get starter");
    expect(prompt).not.toContain("progress to");
  });
});
