import { loadPrompt } from "./loader.js";

export function buildGameKnowledge(): string {
  return [
    loadPrompt("world-rules.md"),
    loadPrompt("progression-model.md"),
    loadPrompt("npc-rules.md"),
    loadPrompt("stuck-patterns.md"),
    loadPrompt("output-rules.md"),
  ].join("\n\n");
}
