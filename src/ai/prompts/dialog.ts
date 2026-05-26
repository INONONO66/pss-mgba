import { loadPrompt } from "./loader.js";

export function buildDialogContext(): string {
  return loadPrompt("dialog.md");
}
