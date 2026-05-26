import { describe, expect, it } from "vitest";

import { buildGameKnowledge } from "../../../src/ai/prompts/game-knowledge.js";

describe("buildGameKnowledge", () => {
  it("includes core game-knowledge sections", () => {
    const prompt = buildGameKnowledge();

    expect(prompt).toContain("World");
    expect(prompt).toContain("Progression");
    expect(prompt).toContain("NPC");
    expect(prompt).toContain("Stuck");
  });

  it("preserves required output rules", () => {
    const prompt = buildGameKnowledge();

    expect(prompt).toContain("exactly one game-action tool call");
    expect(prompt).toContain("note tools alone are invalid");
    expect(prompt).toContain("currently exposed tools");
    expect(prompt).toContain("Do not answer with a JSON command in plain text");
    expect(prompt).toContain("No emulator/RAM memory writes or emulator manipulation");
    expect(prompt).toContain("Base decisions on observed state only");
  });

  it("does not include explicit objectives", () => {
    const prompt = buildGameKnowledge().toLowerCase();

    expect(prompt).not.toContain("go to");
    expect(prompt).not.toContain("get starter");
    expect(prompt).not.toContain("progress to");
  });
});
