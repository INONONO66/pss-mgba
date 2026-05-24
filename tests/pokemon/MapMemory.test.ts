import { describe, expect, it } from "vitest";
import { MapMemory } from "../../src/pokemon/MapMemory.js";
import type { GameWorldSnapshot } from "../../src/pokemon/GameWorld.js";

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
    mapLayout: { mapId: 3, tilesetId: 0, height: 20, width: 20, grid: [] },
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
