import { describe, expect, it } from "vitest";
import { createNavigateWorldReader, type RamReader } from "../../src/executor/MgbaAdapters.js";
import type { MgbaButton } from "../../src/mgba/MgbaTypes.js";
import { RED_BLUE_MEMORY_MAP } from "../../src/pokemon/memoryMap.js";

const map = RED_BLUE_MEMORY_MAP;

function ramReader(values: Map<number, number>, tileMap: Uint8Array): RamReader {
  return {
    read8(address: number) {
      return Promise.resolve(values.get(address) ?? 0);
    },
    readRange(address: number, length: number) {
      if (address === map.wTileMap) {
        return Promise.resolve(tileMap);
      }
      return Promise.resolve(Uint8Array.from({ length }, (_, index) => values.get(address + index) ?? 0));
    },
    holdButton(_button: MgbaButton, _frames: number) {
      return Promise.resolve();
    },
  };
}

describe("MgbaAdapters", () => {
  it("classifies input-masked text as dialog while text is still printing", async () => {
    const values = new Map<number, number>([
      [map.wJoyIgnore, 0xff],
      [map.wTextBoxID, 1],
    ]);
    const reader = createNavigateWorldReader(ramReader(values, new Uint8Array(map.wTileMapLength)));

    await expect(reader.isDialogActive()).resolves.toBe(true);
  });

  it("classifies textBoxId alone as dialog even without screen text", async () => {
    const values = new Map<number, number>([
      [map.wJoyIgnore, 0],
      [map.wTextBoxID, 1],
    ]);
    const reader = createNavigateWorldReader(ramReader(values, new Uint8Array(map.wTileMapLength)));

    await expect(reader.isDialogActive()).resolves.toBe(true);
  });

  it("classifies visible text box text as dialog", async () => {
    const values = new Map<number, number>([
      [map.wJoyIgnore, 0],
      [map.wTextBoxID, 1],
    ]);
    const tileMap = new Uint8Array(map.wTileMapLength);
    tileMap[0] = 0x8c;
    tileMap[1] = 0x8e;
    tileMap[2] = 0x8c;
    const reader = createNavigateWorldReader(ramReader(values, tileMap));

    await expect(reader.isDialogActive()).resolves.toBe(true);
  });
});
