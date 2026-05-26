import { describe, expect, it } from "vitest";
import {
  createDialogStateReader,
  createNavigateWorldReader,
  type RamReader,
} from "../../src/executor/MgbaAdapters.js";
import type { MgbaButton } from "../../src/mgba/MgbaTypes.js";
import { RED_BLUE_MEMORY_MAP } from "../../src/game/memoryMap.js";
import { RWY_ADDRESS } from "../../src/game/GameWorld.js";

const map = RED_BLUE_MEMORY_MAP;

function ramReader(
  values: Map<number, number>,
  tileMap: Uint8Array
): RamReader {
  return {
    read8(address: number) {
      return Promise.resolve(values.get(address) ?? 0);
    },
    readRange(address: number, length: number) {
      if (address === map.wTileMap) {
        return Promise.resolve(tileMap);
      }
      return Promise.resolve(
        Uint8Array.from(
          { length },
          (_, index) => values.get(address + index) ?? 0
        )
      );
    },
    holdButton(_button: MgbaButton, _frames: number) {
      return Promise.resolve();
    },
  };
}

describe("MgbaAdapters", () => {
  it("classifies window-visible state as dialog active", async () => {
    const values = new Map<number, number>([
      [RWY_ADDRESS, 80],
    ]);
    const reader = createNavigateWorldReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isDialogActive()).resolves.toBe(true);
  });

  it("classifies window-hidden state as dialog inactive", async () => {
    const values = new Map<number, number>([
      [RWY_ADDRESS, 144],
    ]);
    const reader = createNavigateWorldReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isDialogActive()).resolves.toBe(false);
  });

  it("classifies rWY above 144 as dialog inactive", async () => {
    const values = new Map<number, number>([
      [RWY_ADDRESS, 200],
    ]);
    const reader = createNavigateWorldReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isDialogActive()).resolves.toBe(false);
  });

  it("detects choice when tilemap has sub-box corner at row 7 col 14", async () => {
    const values = new Map<number, number>([
      [map.wTileMap + 7 * 20 + 14, 0x79],
    ]);
    const reader = createDialogStateReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isChoiceActive()).resolves.toBe(true);
  });

  it("reports no choice when tilemap has no sub-box corner", async () => {
    const reader = createDialogStateReader(
      ramReader(new Map(), new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isChoiceActive()).resolves.toBe(false);
  });

  it("reports window visible when rWY < 144", async () => {
    const values = new Map<number, number>([
      [RWY_ADDRESS, 64],
    ]);
    const reader = createDialogStateReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isWindowVisible()).resolves.toBe(true);
  });

  it("reports window not visible when rWY >= 144", async () => {
    const values = new Map<number, number>([
      [RWY_ADDRESS, 144],
    ]);
    const reader = createDialogStateReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isWindowVisible()).resolves.toBe(false);
  });

  it("reports in battle when wIsInBattle is non-zero", async () => {
    const values = new Map<number, number>([
      [map.wIsInBattle, 1],
    ]);
    const reader = createDialogStateReader(
      ramReader(values, new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isInBattle()).resolves.toBe(true);
  });

  it("reports not in battle when wIsInBattle is zero", async () => {
    const reader = createDialogStateReader(
      ramReader(new Map(), new Uint8Array(map.wTileMapLength))
    );

    await expect(reader.isInBattle()).resolves.toBe(false);
  });
});
