import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
process.chdir(tmpdir());

const memoryMapModule = (await import(
  pathToFileURL(path.join(repoRoot, "dist", "src", "pokemon", "memoryMap.js"))
    .href
)) as Record<string, unknown>;

function assertEqual(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`${name} expected ${expected}, got ${String(actual)}`);
  }
}

const redBlueMemoryMap = memoryMapModule.RED_BLUE_MEMORY_MAP as
  | Record<string, unknown>
  | undefined;

if (!redBlueMemoryMap) {
  throw new Error("RED_BLUE_MEMORY_MAP export is missing");
}

assertEqual("wCurMap", memoryMapModule.wCurMap, 0xd3_5e);
assertEqual("RED_BLUE_MEMORY_MAP.wCurMap", redBlueMemoryMap.wCurMap, 0xd3_5e);
assertEqual("HALL_OF_FAME_MAP_ID", memoryMapModule.HALL_OF_FAME_MAP_ID, 0x76);

console.log("Built memory map import smoke passed");
