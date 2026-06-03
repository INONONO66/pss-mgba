import type { GameMode } from "../../control/CommandTypes.js";
import { loadPrompt } from "./loader.js";

export function buildGameKnowledge(mode: GameMode): string {
  // Core: always included regardless of mode
  const sections = [
    loadPrompt("world-rules.md"),
    loadPrompt("output-rules.md"),
    loadPrompt("memory-rules.md"),
  ];

  // overworld: full knowledge — navigation, NPCs, stuck recovery, resources, types
  // battle: combat-focused — types, party/resources, no NPC or stuck (can't get stuck in battle)
  // dialog: minimal — move learning needs type chart, but no navigation/NPC/stuck/resources
  if (mode !== "dialog") {
    sections.push(loadPrompt("progression-model.md"));
  }

  if (mode === "overworld") {
    sections.push(loadPrompt("stuck-patterns.md"));
    sections.push(loadPrompt("npc-rules.md"));
  }

  // type chart needed in battle (move selection) and dialog (move learning decisions)
  if (mode === "battle" || mode === "dialog") {
    sections.push(loadPrompt("type-chart.md"));
  }

  return sections.join("\n\n");
}
