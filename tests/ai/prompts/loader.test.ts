import { describe, expect, it } from "vitest";
import { loadPrompt } from "../../../src/ai/prompts/loader.js";

const allPromptFiles = [
  "overworld.md",
  "battle.md",
  "dialog.md",
  "world-rules.md",
  "progression-model.md",
  "npc-rules.md",
  "stuck-patterns.md",
  "output-rules.md",
];

describe("loadPrompt", () => {
  it("returns non-empty string for each .md file", () => {
    for (const file of allPromptFiles) {
      const content = loadPrompt(file);
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("returns cached content on second call (same reference)", () => {
    const first = loadPrompt("overworld.md");
    const second = loadPrompt("overworld.md");
    expect(first).toBe(second);
  });

  it("throws on missing .md file", () => {
    expect(() => loadPrompt("nonexistent.md")).toThrow();
  });
});
