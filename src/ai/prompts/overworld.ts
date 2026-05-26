import { loadPrompt } from "./loader.js";

export function buildOverworldContext(): string {
  return loadPrompt("overworld.md");
}
