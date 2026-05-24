import { describe, expect, it } from "vitest";
import { RED_BLUE_MEMORY_MAP } from "../../src/pokemon/memoryMap.js";
import { readTileCollisionData } from "../../src/pokemon/TilesetData.js";

const map = RED_BLUE_MEMORY_MAP;

describe("TilesetData", () => {
  it("reads collision metadata and tile table with bounded range reads", async () => {
    const calls: Array<{ method: "read8"; address: number } | { method: "readRange"; address: number; length: number }> = [];
    const collPtr = 0xc123;
    const metadataLength = map.wTilesetGrassTile - map.wTilesetCollisionPtr + 1;
    const client = {
      async read8(address: number): Promise<number> {
        calls.push({ method: "read8", address });
        return address === map.wCurMapTileset ? 4 : 0;
      },
      async readRange(address: number, length: number): Promise<Uint8Array> {
        calls.push({ method: "readRange", address, length });
        if (address === map.wTilesetCollisionPtr) {
          const bytes = Array.from({ length }, () => 0);
          bytes[0] = collPtr & 0xff;
          bytes[1] = collPtr >> 8;
          bytes[map.wTilesetGrassTile - map.wTilesetCollisionPtr] = 0x52;
          return Uint8Array.from(bytes);
        }
        if (address === collPtr) {
          return Uint8Array.from([0x01, 0x02, 0xff, 0x03, ...Array.from({ length: length - 4 }, () => 0)]);
        }
        return Uint8Array.from(Array.from({ length }, () => 0));
      }
    };

    const collision = await readTileCollisionData(client);

    expect(collision.tilesetId).toBe(4);
    expect(collision.grassTile).toBe(0x52);
    expect([...collision.walkableTiles]).toEqual([0x01, 0x02]);
    expect(calls).toEqual([
      { method: "read8", address: map.wCurMapTileset },
      { method: "readRange", address: map.wTilesetCollisionPtr, length: metadataLength },
      { method: "readRange", address: collPtr, length: 64 },
    ]);
  });
});
