import { describe, expect, it } from "vitest";
import { MapMemory } from "../../src/pokemon/MapMemory.js";
import type { GameWorldSnapshot } from "../../src/pokemon/GameWorld.js";
import { mapName } from "../../src/pokemon/PokemonCatalog.js";

const SCREEN_TILE_W = 20;
const SCREEN_TILE_H = 18;

function tileMap(fill = 0x01): Uint8Array {
  return Uint8Array.from({ length: SCREEN_TILE_W * SCREEN_TILE_H }, () => fill);
}

describe("MapMemory", () => {
  it("records tiles when the player screen anchor has odd parity", () => {
    const memory = new MapMemory();

    memory.update(createWorld({ yScreen: 69, xScreen: 73 }), tileMap(0x01));

    const view = memory.view(3);
    expect(view).toMatchObject({ mapId: 3, width: 20, height: 20 });
    expect(view?.tileCount).toBeGreaterThan(0);
    expect(memory.tileAt(3, 5, 7)).toBe("walkable");
  });

  it("does not corrupt map memory during transient or incomplete snapshots", () => {
    const memory = new MapMemory();
    const bytes = tileMap(0x01);

    memory.update(createWorld({ mode: "title" }), bytes);
    memory.update(createWorld({ mode: "naming" }), bytes);
    memory.update(createWorld({ walkCounter: 1 }), bytes);
    memory.update(createWorld(), bytes.slice(0, 12));

    expect(memory.visitedMaps()).toEqual([]);
    expect(memory.totalTiles()).toBe(0);
  });

  it("renders full maps with warp overlays", () => {
    const memory = new MapMemory();
    seedRecord(memory, 0, 10, 9, 63, [
      [1, 3, "walkable"],
      [1, 4, "walkable"],
    ]);

    const output = memory.renderFullMap(0, 3, 5, [
      { y: 1, x: 3, destMapId: 1, destWarpId: 0 },
    ]);

    expect(output).toContain("W");
    expect(output).toContain("Coverage: 63/90 tiles");
  });

  it("lets the player marker override warp tiles", () => {
    const memory = new MapMemory();
    seedRecord(memory, 0, 4, 4, 4, [[2, 2, "walkable"]]);

    const output = memory.renderFullMap(0, 2, 2, [{ y: 2, x: 2, destMapId: 1, destWarpId: 0 }]);
    const playerRow = output.split("\n")[4];

    expect(playerRow).toContain("@");
    expect(playerRow).not.toContain("W");
  });

  it("includes the map name, dimensions, and explored percentage in the header", () => {
    const memory = new MapMemory();
    seedRecord(memory, 0, 10, 9, 63, []);

    const output = memory.renderFullMap(0, 0, 0);

    expect(output.split("\n")[0]).toBe(`=== CURRENT MAP: ${mapName(0)} (map 0), 10x9, explored 70% ===`);
  });

  it("computes explored percent from known tiles", () => {
    const memory = new MapMemory();
    seedRecord(memory, 1, 5, 5, 13, []);

    expect(memory.exploredPercent(1)).toBe(52);
  });

  it("returns zero explored percent for unknown maps", () => {
    const memory = new MapMemory();

    expect(memory.exploredPercent(999)).toBe(0);
  });

  it("renders adjacent tile types in micro view", () => {
    const memory = new MapMemory();
    seedRecord(memory, 2, 3, 3, 5, [
      [0, 1, "walkable"],
      [2, 1, "grass"],
      [1, 0, "wall"],
    ]);

    const output = memory.renderMicro(2, 1, 1, "down");

    expect(output).toBe("Position: (1,1), facing down\nAdjacent: Up:open, Down:open, Left:wall, Right:unknown");
  });

  it("detects NPCs in adjacent micro tiles", () => {
    const memory = new MapMemory();
    seedRecord(memory, 3, 3, 3, 1, [[1, 2, "walkable"]], [{ y: 1, x: 2 }]);

    const output = memory.renderMicro(3, 1, 1, "left");

    expect(output).toContain("Right:npc");
  });
});

function createWorld(overrides: {
  readonly mode?: GameWorldSnapshot["mode"];
  readonly yScreen?: number;
  readonly xScreen?: number;
  readonly mapY?: number;
  readonly mapX?: number;
  readonly walkCounter?: number;
} = {}): GameWorldSnapshot {
  const mapY = overrides.mapY ?? 5;
  const mapX = overrides.mapX ?? 7;
  return {
    mode: overrides.mode ?? "overworld",
    modeFlags: {
      battle: 0,
      textBoxId: 0,
      letterDelay: 0,
      curMap: 3,
      yCoord: mapY,
      xCoord: mapX,
      partyCount: 1,
      walkCounter: overrides.walkCounter ?? 0,
      joyIgnore: 0,
      namingScreenType: 0,
      screenText: "",
    },
    tileMapBytes: tileMap(0x01),
    mapLayout: { mapId: 3, tilesetId: 0, height: 20, width: 20 },
    sprites: {
      player: {
        slot: 0,
        isPlayer: true,
        pictureId: 1,
        movementStatus: 0,
        yScreen: overrides.yScreen ?? 68,
        xScreen: overrides.xScreen ?? 72,
        facing: "down",
        mapY,
        mapX,
        inGrass: false,
        onScreen: true,
        movementType: "stationary",
      },
      npcs: [],
      spriteCount: 1,
    },
    warps: { warps: [], connections: { north: undefined, south: undefined, west: undefined, east: undefined } },
    tileCollision: { tilesetId: 0, walkableTiles: new Set([0x01]), grassTile: 0x02 },
    playerCoords: { y: mapY, x: mapX },
    tileInFront: 0,
    tileStandingOn: 0,
    grassRate: 0,
  };
}

function seedRecord(
  memory: MapMemory,
  mapId: number,
  width: number,
  height: number,
  tileCount: number,
  tiles: Array<[number, number, "walkable" | "wall" | "grass"]>,
  npcPositions: Array<{ y: number; x: number }> = [],
): void {
  const record = {
    mapId,
    width,
    height,
    tiles: new Map<string, { type: "walkable" | "wall" | "grass"; tileId: number }>(),
    npcPositions,
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (record.tiles.size >= tileCount) break;
      record.tiles.set(`${y},${x}`, { type: "walkable", tileId: 0 });
    }
  }

  for (const [y, x, type] of tiles) {
    record.tiles.set(`${y},${x}`, { type, tileId: 0 });
  }

  (memory as unknown as { maps: Map<number, unknown> }).maps.set(mapId, record);
}
