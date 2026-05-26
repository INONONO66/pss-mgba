import { describe, expect, it } from "vitest";
import { RED_BLUE_MEMORY_MAP } from "../../src/game/memoryMap.js";
import { classifyTile, readTileCollisionData } from "../../src/game/TilesetData.js";
import { TILESET } from "../../src/game/tilesetSpecialTiles.js";

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

describe("classifyTile", () => {
  it("classifies Overworld water tile $14 as water terrain", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x01]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x14);
    expect(result.terrain).toBe("water");
    expect(result.tileId).toBe(0x14);
  });

  it("classifies Overworld grass tile $52 as grass with cuttable feature", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x52]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x52);
    expect(result.terrain).toBe("grass");
    expect(result.features).toContain("cuttable");
  });

  it("classifies Overworld cut tree $3D as wall with cuttable feature", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x01]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x3D);
    expect(result.terrain).toBe("wall");
    expect(result.features).toContain("cuttable");
  });

  it("classifies Overworld ledge tile $37 with ledge feature", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x01]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x37);
    expect(result.features).toContain("ledge");
  });

  it("classifies Overworld door tile $1B with door feature", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x1B]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x1B);
    expect(result.terrain).toBe("walkable");
    expect(result.features).toContain("door");
    expect(result.features).toContain("warp");
  });

  it("classifies Gym cut tree $50 with cuttable feature", () => {
    const collision = { tilesetId: TILESET.GYM, walkableTiles: new Set([0x01]), grassTile: undefined };
    const result = classifyTile(collision, 0x50);
    expect(result.features).toContain("cuttable");
  });

  it("classifies Gym counter tile $3A with counter feature", () => {
    const collision = { tilesetId: TILESET.GYM, walkableTiles: new Set([0x01]), grassTile: undefined };
    const result = classifyTile(collision, 0x3A);
    expect(result.features).toContain("counter");
  });

  it("does NOT classify $14 as water in non-water tileset (HOUSE)", () => {
    const collision = { tilesetId: TILESET.HOUSE, walkableTiles: new Set([0x14]), grassTile: undefined };
    const result = classifyTile(collision, 0x14);
    expect(result.terrain).toBe("walkable");
    expect(result.terrain).not.toBe("water");
  });

  it("classifies Mart door tile $5E with door feature", () => {
    const collision = { tilesetId: TILESET.MART, walkableTiles: new Set([0x5E]), grassTile: undefined };
    const result = classifyTile(collision, 0x5E);
    expect(result.features).toContain("door");
  });

  it("classifies plain walkable tile with no features", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x01]), grassTile: 0x52 };
    const result = classifyTile(collision, 0x01);
    expect(result.terrain).toBe("walkable");
    expect(result.features).toEqual([]);
  });

  it("classifies plain wall tile with no features", () => {
    const collision = { tilesetId: TILESET.OVERWORLD, walkableTiles: new Set([0x01]), grassTile: 0x52 };
    const result = classifyTile(collision, 0xFF);
    expect(result.terrain).toBe("wall");
    expect(result.features).toEqual([]);
  });
});
