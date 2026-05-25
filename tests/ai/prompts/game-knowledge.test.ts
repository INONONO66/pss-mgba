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

    expect(prompt).toContain("JSON object");
    expect(prompt).toContain("command types");
    expect(prompt).toContain("Only use provided command types");
    expect(prompt).toContain("No memory writes or emulator manipulation");
    expect(prompt).toContain("Base decisions on observed state only");
    expect(prompt).toContain("Output exactly one JSON object per turn");
  });

  it("does not include explicit objectives", () => {
    const prompt = buildGameKnowledge().toLowerCase();

    expect(prompt).not.toContain("go to");
    expect(prompt).not.toContain("get starter");
    expect(prompt).not.toContain("progress to");
  });
});
