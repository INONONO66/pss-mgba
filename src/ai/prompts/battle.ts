import { loadPrompt } from "./loader.js";

export function buildBattleContext(): string {
  return loadPrompt("battle.md");
}
