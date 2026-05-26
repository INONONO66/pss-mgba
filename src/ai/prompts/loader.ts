import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const cache = new Map<string, string>();
const promptsDir = path.dirname(fileURLToPath(import.meta.url));

export function loadPrompt(filename: string): string {
  const cached = cache.get(filename);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(path.join(promptsDir, filename), "utf8").trim();
  cache.set(filename, content);
  return content;
}
