import type { TileFeature } from "./TilesetData.js";

// Tileset IDs from pokered constants/tileset_constants.asm
export const TILESET = {
  OVERWORLD: 0,
  REDS_HOUSE_1: 1,
  MART: 2,
  FOREST: 3,
  REDS_HOUSE_2: 4,
  DOJO: 5,
  POKECENTER: 6,
  GYM: 7,
  HOUSE: 8,
  FOREST_GATE: 9,
  MUSEUM: 10,
  UNDERGROUND: 11,
  GATE: 12,
  SHIP: 13,
  SHIP_PORT: 14,
  CEMETERY: 15,
  INTERIOR: 16,
  CAVERN: 17,
  LOBBY: 18,
  MANSION: 19,
  LAB: 20,
  CLUB: 21,
  FACILITY: 22,
  PLATEAU: 23,
} as const;

// Water tile IDs — only for water-capable tilesets
// From pokered: data/tilesets/water_tilesets.asm, home/overworld.asm:1888-1945
export const WATER_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.OVERWORLD, new Set([0x14, 0x32, 0x48])],
  [TILESET.FOREST, new Set([0x14, 0x32, 0x48])],
  [TILESET.DOJO, new Set([0x14])],
  [TILESET.GYM, new Set([0x14])],
  [TILESET.SHIP, new Set([0x14])],
  [TILESET.SHIP_PORT, new Set([0x14, 0x48])],
  [TILESET.CAVERN, new Set([0x14, 0x32, 0x48])],
  [TILESET.FACILITY, new Set([0x14])],
  [TILESET.PLATEAU, new Set([0x14, 0x32, 0x48])],
]);

// Cut tree tiles — from pokered: engine/overworld/cut.asm
// Key = tileset ID, Value = set of cuttable tile IDs
export const CUTTABLE_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.OVERWORLD, new Set([0x3d, 0x52])],
  [TILESET.GYM, new Set([0x50])],
]);

// Ledge tiles — from pokered: data/tilesets/ledge_tiles.asm
// Overworld only. These are the LEDGE tiles (the tile you jump over/onto)
export const LEDGE_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.OVERWORLD, new Set([0x37, 0x36, 0x27, 0x0d, 0x1d])],
]);

// Counter tiles — from pokered: data/tilesets/tileset_headers.asm (3 per header)
export const COUNTER_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.MART, new Set([0x18, 0x19, 0x1e])],
  [TILESET.POKECENTER, new Set([0x18, 0x19, 0x1e])],
  [TILESET.DOJO, new Set([0x3a])],
  [TILESET.GYM, new Set([0x3a])],
  [TILESET.FOREST_GATE, new Set([0x17, 0x32])],
  [TILESET.MUSEUM, new Set([0x17, 0x32])],
  [TILESET.GATE, new Set([0x17, 0x32])],
  [TILESET.CEMETERY, new Set([0x12])],
  [TILESET.FACILITY, new Set([0x12])],
  [TILESET.LOBBY, new Set([0x15, 0x36])],
  [TILESET.CLUB, new Set([0x07, 0x17])],
  [TILESET.PLATEAU, new Set([0x45])],
]);

// Door tiles — from pokered: data/tilesets/door_tile_ids.asm
export const DOOR_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.OVERWORLD, new Set([0x1b, 0x58])],
  [TILESET.FOREST_GATE, new Set([0x3b])],
  [TILESET.MUSEUM, new Set([0x3b])],
  [TILESET.GATE, new Set([0x3b])],
  [TILESET.REDS_HOUSE_1, new Set([0x1a, 0x1c])],
  [TILESET.REDS_HOUSE_2, new Set([0x1a, 0x1c])],
  [TILESET.MART, new Set([0x5e])],
  [TILESET.POKECENTER, new Set([0x5e])],
  [TILESET.FOREST, new Set([0x3a])],
  [TILESET.DOJO, new Set([0x4a])],
  [TILESET.GYM, new Set([0x4a])],
  [TILESET.HOUSE, new Set([0x54])],
  [TILESET.SHIP, new Set([0x1e])],
  [TILESET.LOBBY, new Set([0x1c, 0x38, 0x1a])],
  [TILESET.MANSION, new Set([0x1a, 0x1c, 0x53])],
  [TILESET.LAB, new Set([0x34])],
  [TILESET.FACILITY, new Set([0x43, 0x58, 0x1b])],
  [TILESET.CEMETERY, new Set([0x1b])],
  [TILESET.PLATEAU, new Set([0x3b, 0x1b])],
]);

// Warp tiles — from pokered: data/tilesets/warp_tile_ids.asm
// NOTE: pokered uses fallthrough chains; all inherited tile IDs are resolved here.
export const WARP_TILES: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [TILESET.OVERWORLD, new Set([0x1b, 0x58])],
  [TILESET.REDS_HOUSE_1, new Set([0x1a, 0x1c])],
  [TILESET.MART, new Set([0x5e])],
  [TILESET.FOREST, new Set([0x5a, 0x5c, 0x3a])],
  [TILESET.REDS_HOUSE_2, new Set([0x1a, 0x1c])],
  [TILESET.DOJO, new Set([0x4a])],
  [TILESET.POKECENTER, new Set([0x5e])],
  [TILESET.GYM, new Set([0x4a])],
  [TILESET.HOUSE, new Set([0x54, 0x5c, 0x32])],
  [TILESET.FOREST_GATE, new Set([0x3b, 0x1a, 0x1c])],
  [TILESET.MUSEUM, new Set([0x3b, 0x1a, 0x1c])],
  [TILESET.UNDERGROUND, new Set([0x13])],
  [TILESET.GATE, new Set([0x3b, 0x1a, 0x1c])],
  [TILESET.SHIP, new Set([0x37, 0x39, 0x1e, 0x4a])],
  [TILESET.CEMETERY, new Set([0x1b, 0x13])],
  [TILESET.INTERIOR, new Set([0x15, 0x55, 0x04])],
  [TILESET.CAVERN, new Set([0x18, 0x1a, 0x22])],
  [TILESET.LOBBY, new Set([0x1a, 0x1c, 0x38])],
  [TILESET.MANSION, new Set([0x1a, 0x1c, 0x53])],
  [TILESET.LAB, new Set([0x34])],
  [TILESET.FACILITY, new Set([0x43, 0x58, 0x20, 0x1b, 0x13])],
  [TILESET.PLATEAU, new Set([0x1b, 0x3b])],
]);

export function getTileFeatures(tilesetId: number, tileId: number): TileFeature[] {
  const features: TileFeature[] = [];
  if (CUTTABLE_TILES.get(tilesetId)?.has(tileId)) {
    features.push("cuttable");
  }
  if (LEDGE_TILES.get(tilesetId)?.has(tileId)) {
    features.push("ledge");
  }
  if (COUNTER_TILES.get(tilesetId)?.has(tileId)) {
    features.push("counter");
  }
  if (DOOR_TILES.get(tilesetId)?.has(tileId)) {
    features.push("door");
  }
  if (WARP_TILES.get(tilesetId)?.has(tileId)) {
    features.push("warp");
  }
  return features;
}

export function isWaterTile(tilesetId: number, tileId: number): boolean {
  return WATER_TILES.get(tilesetId)?.has(tileId) ?? false;
}
