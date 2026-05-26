import type { GameWorldSnapshot } from "./GameWorld.js";
import { classifyTile, type ClassifiedTile, type TileCollisionData, type TileFeature, type TileTerrain, type TileType } from "./TilesetData.js";
import { mapName } from "./PokemonCatalog.js";
import type { WarpEntry } from "./WarpReader.js";
import { GEN1_SPRITE_NAMES } from "./data/Gen1Names.js";

const FIRST_STILL_SPRITE = 0x3d;

interface NpcPosition { readonly y: number; readonly x: number; readonly slot: number; readonly pictureId: number }

function npcMapChar(slot: number): string {
  return slot.toString(36);
}

function isItemSprite(pictureId: number): boolean {
  return pictureId >= FIRST_STILL_SPRITE;
}

function buildNpcLegend(npcs: readonly NpcPosition[]): string {
  if (npcs.length === 0) return "";
  return npcs.map((n) => {
    const tag = isItemSprite(n.pictureId) ? "Item" : "NPC";
    const name = GEN1_SPRITE_NAMES[n.pictureId] ?? `sprite:${n.pictureId}`;
    return `${npcMapChar(n.slot)}=${name}(${tag})`;
  }).join(" ");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordedTile {
  readonly terrain?: TileTerrain;
  readonly features?: readonly TileFeature[];
  readonly type?: TileType;
  readonly tileId: number;
}

export interface KnownNpc {
  readonly slot: number;
  readonly pictureId: number;
  readonly mapY: number;
  readonly mapX: number;
  readonly movementType: string;
  readonly onScreen: boolean;
  lastSeenTurn: number;
}

export interface MapRecord {
  readonly mapId: number;
  width: number;
  height: number;
  readonly tiles: Map<string, RecordedTile>;
  npcPositions: ReadonlyArray<{ readonly y: number; readonly x: number; readonly slot: number; readonly pictureId: number }>;
  knownNpcs: Map<number, KnownNpc>;
}

export interface MapRecordView {
  readonly mapId: number;
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly npcPositions: ReadonlyArray<{ readonly y: number; readonly x: number; readonly slot: number; readonly pictureId: number }>;
}

export type MapMemoryUpdateResult =
  | { readonly status: "updated" }
  | { readonly status: "skipped"; readonly reason: "short_tilemap" | "inactive_mode" | "walking" | "missing_player" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_TILE_W = 20;
const SCREEN_TILE_H = 18;
const OFFSCREEN_TILE = 0x10;

// ---------------------------------------------------------------------------
// MapMemory
// ---------------------------------------------------------------------------

export class MapMemory {
  private readonly maps = new Map<number, MapRecord>();
  private turnCounter = 0;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  update(world: GameWorldSnapshot, screenTileBytes: Uint8Array): MapMemoryUpdateResult {
    if (screenTileBytes.length < SCREEN_TILE_W * SCREEN_TILE_H) {
      return { status: "skipped", reason: "short_tilemap" };
    }
    if (world.mode === "title" || world.mode === "naming") {
      return { status: "skipped", reason: "inactive_mode" };
    }
    if (world.modeFlags.walkCounter !== 0) {
      return { status: "skipped", reason: "walking" };
    }

    const player = world.sprites.player;
    if (player === undefined) {
      return { status: "skipped", reason: "missing_player" };
    }

    const mapId = world.mapLayout.mapId;
    const record = this.getOrCreate(mapId);

    if (world.mapLayout.width > 0) {
      record.width = world.mapLayout.width * 2;
    }
    if (world.mapLayout.height > 0) {
      record.height = world.mapLayout.height * 2;
    }

    const playerScrY = Math.floor((player.yScreen + 4) / 8);
    const playerScrX = Math.floor(player.xScreen / 8);
    const playerBlockY = world.playerCoords.y;
    const playerBlockX = world.playerCoords.x;

    // Align player screen position to 2×2 block grid (bit-clear LSB)
    const playerBlockScrY = playerScrY - (playerScrY % 2);
    const playerBlockScrX = playerScrX - (playerScrX % 2);

    for (let sy = 0; sy + 1 < SCREEN_TILE_H; sy += 2) {
      for (let sx = 0; sx + 1 < SCREEN_TILE_W; sx += 2) {
        const t0 = screenTileBytes[sy * SCREEN_TILE_W + sx];
        const t1 = screenTileBytes[sy * SCREEN_TILE_W + sx + 1];
        const t2 = screenTileBytes[(sy + 1) * SCREEN_TILE_W + sx];
        const t3 = screenTileBytes[(sy + 1) * SCREEN_TILE_W + sx + 1];

        if (t0 === OFFSCREEN_TILE || t1 === OFFSCREEN_TILE || t2 === OFFSCREEN_TILE || t3 === OFFSCREEN_TILE) {
          continue;
        }

        const blockY = playerBlockY + (sy - playerBlockScrY) / 2;
        const blockX = playerBlockX + (sx - playerBlockScrX) / 2;

        if (record.width > 0 && record.height > 0) {
          if (blockY < 0 || blockY >= record.height || blockX < 0 || blockX >= record.width) {
            continue;
          }
        }

        const tile = classifyBlock(world.tileCollision, t0, t1, t2, t3);
        const key = `${blockY},${blockX}`;
        record.tiles.set(key, tile);
      }
    }

    const onScreenNpcs = world.sprites.npcs.filter((npc) => npc.onScreen);
    const onScreenSlots = new Set(onScreenNpcs.map((npc) => npc.slot));
    const turn = ++this.turnCounter;

    record.npcPositions = onScreenNpcs.map((npc) => ({ y: npc.mapY, x: npc.mapX, slot: npc.slot, pictureId: npc.pictureId }));

    for (const [slot, knownNpc] of record.knownNpcs) {
      if (knownNpc.onScreen && !onScreenSlots.has(slot)) {
        record.knownNpcs.set(slot, { ...knownNpc, onScreen: false });
      }
    }

    for (const npc of onScreenNpcs) {
      record.knownNpcs.set(npc.slot, {
        slot: npc.slot,
        pictureId: npc.pictureId,
        mapY: npc.mapY,
        mapX: npc.mapX,
        movementType: npc.movementType,
        onScreen: true,
        lastSeenTurn: turn,
      });
    }

    return { status: "updated" };
  }

  get(mapId: number): MapRecord | undefined {
    return this.maps.get(mapId);
  }

  view(mapId: number): MapRecordView | undefined {
    const record = this.maps.get(mapId);
    if (record === undefined) {
      return undefined;
    }
    return {
      mapId: record.mapId,
      width: record.width,
      height: record.height,
      tileCount: record.tiles.size,
      npcPositions: record.npcPositions,
    };
  }

  visitedMaps(): number[] {
    return [...this.maps.keys()];
  }

  totalTiles(): number {
    let total = 0;
    for (const record of this.maps.values()) {
      total += record.tiles.size;
    }
    return total;
  }

  tileAt(mapId: number, y: number, x: number): TileType | undefined {
    const tile = this.maps.get(mapId)?.tiles.get(`${y},${x}`);
    return tile === undefined ? undefined : tileTerrain(tile);
  }

  recordedTileAt(mapId: number, y: number, x: number): RecordedTile | undefined {
    return this.maps.get(mapId)?.tiles.get(`${y},${x}`);
  }

  getKnownNpcs(mapId: number): ReadonlyArray<KnownNpc> {
    const record = this.maps.get(mapId);
    if (record === undefined) {
      return [];
    }
    return [...record.knownNpcs.values()].sort((a, b) => b.lastSeenTurn - a.lastSeenTurn);
  }

  walkabilityGrid(
    mapId: number,
    capabilities: { canSurf?: boolean; canCut?: boolean } = {},
  ): { grid: boolean[][]; width: number; height: number } | undefined {
    const record = this.maps.get(mapId);
    if (record === undefined || record.width === 0 || record.height === 0) {
      return undefined;
    }

    const { canSurf = false, canCut = false } = capabilities;
    const npcSet = new Set(record.npcPositions.map((p) => `${p.y},${p.x}`));
    const grid: boolean[][] = [];

    for (let y = 0; y < record.height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < record.width; x++) {
        const key = `${y},${x}`;
        if (npcSet.has(key)) {
          row.push(false);
          continue;
        }
        const tile = record.tiles.get(key);
        if (tile === undefined) {
          row.push(true);
          continue;
        }
        const terrain = tileTerrain(tile);
        const features = tileFeatures(tile);
        if (terrain === "wall") {
          row.push(canCut && features.includes("cuttable"));
        } else if (terrain === "water") {
          row.push(canSurf);
        } else {
          row.push(true);
        }
      }
      grid.push(row);
    }

    return { grid, width: record.width, height: record.height };
  }

  renderAscii(mapId: number, playerY?: number, playerX?: number): string {
    const record = this.maps.get(mapId);
    if (record === undefined) {
      return "(no data)";
    }
    if (record.width === 0 || record.height === 0) {
      return "(dimensions unknown)";
    }

    const npcMap = new Map(record.npcPositions.map((p) => [`${p.y},${p.x}`, p]));
    const lines: string[] = [];

    lines.push(`   ${Array.from({ length: record.width }, (_, i) => (i % 10).toString()).join("")}`);

    for (let y = 0; y < record.height; y++) {
      let line = `${y.toString().padStart(2, " ")} `;
      for (let x = 0; x < record.width; x++) {
        const key = `${y},${x}`;
        const npc = npcMap.get(key);
        if (playerY === y && playerX === x) {
          line += "@";
        } else if (npc !== undefined) {
          line += npcMapChar(npc.slot);
        } else {
          const tile = record.tiles.get(key);
          if (tile === undefined) {
            line += "?";
          } else {
            line += tileChar(tileTerrain(tile));
          }
        }
      }
      lines.push(line);
    }

    lines.push("");
    const npcLegend = buildNpcLegend(record.npcPositions);
    lines.push(`  Legend: .=walkable #=wall "=grass ?=unknown @=player ${npcLegend}`);
    lines.push(`  Coverage: ${record.tiles.size}/${record.width * record.height} tiles`);
    return lines.join("\n");
  }

  renderFullMap(mapId: number, playerY?: number, playerX?: number, warps?: readonly WarpEntry[]): string {
    const record = this.maps.get(mapId);
    if (record === undefined) {
      return "(no data)";
    }
    if (record.width === 0 || record.height === 0) {
      return "(dimensions unknown)";
    }

    const npcMap = new Map(record.npcPositions.map((p) => [`${p.y},${p.x}`, p]));
    const warpSet = new Set((warps ?? []).map((warp) => `${warp.y},${warp.x}`));
    const lines: string[] = [];

    lines.push(`=== CURRENT MAP: ${mapName(mapId)} (map ${mapId}), ${record.width}x${record.height}, explored ${this.exploredPercent(mapId)}% ===`);
    lines.push(`   ${Array.from({ length: record.width }, (_, i) => (i % 10).toString()).join("")}`);

    for (let y = 0; y < record.height; y++) {
      let line = `${y.toString().padStart(2, " ")} `;
      for (let x = 0; x < record.width; x++) {
        const key = `${y},${x}`;
        const npc = npcMap.get(key);
        if (playerY === y && playerX === x) {
          line += "@";
        } else if (npc !== undefined) {
          line += npcMapChar(npc.slot);
        } else if (warpSet.has(key)) {
          line += "W";
        } else {
          const tile = record.tiles.get(key);
          line += tile === undefined ? "?" : tileChar(tileTerrain(tile));
        }
      }
      lines.push(line);
    }

    lines.push("");
    const npcLegend = buildNpcLegend(record.npcPositions);
    lines.push(`  Legend: .=walkable #=wall "=grass ?=unknown @=player W=warp ${npcLegend}`);
    lines.push(`  Coverage: ${record.tiles.size}/${record.width * record.height} tiles`);
    return lines.join("\n");
  }

  exploredPercent(mapId: number): number {
    const record = this.maps.get(mapId);
    if (record === undefined || record.width === 0 || record.height === 0) {
      return 0;
    }
    return Math.round((record.tiles.size / (record.width * record.height)) * 100);
  }

  renderMicro(mapId: number, playerY?: number, playerX?: number, facingDirection?: string): string {
    const record = this.maps.get(mapId);
    if (record === undefined) {
      return "(no data)";
    }

    const npcSet = new Set(record.npcPositions.map((p) => `${p.y},${p.x}`));
    const facing = facingDirection ?? "unknown";
    const adjacent: Array<[string, number, number]> = [
      ["Up", (playerY ?? 0) - 1, playerX ?? 0],
      ["Down", (playerY ?? 0) + 1, playerX ?? 0],
      ["Left", playerY ?? 0, (playerX ?? 0) - 1],
      ["Right", playerY ?? 0, (playerX ?? 0) + 1],
    ];

    const describe = (y: number, x: number): string => {
      if (record.width === 0 || record.height === 0) {
        return "unknown";
      }
      if (y < 0 || y >= record.height || x < 0 || x >= record.width) {
        return "unknown";
      }
      const key = `${y},${x}`;
      if (npcSet.has(key)) {
        return "npc";
      }
      const tile = record.tiles.get(key);
      if (tile === undefined) {
        return "unknown";
      }
      const terrain = tileTerrain(tile);
      return terrain === "wall" || terrain === "water" ? "wall" : "open";
    };

    return [
      `Position: (${playerX ?? 0},${playerY ?? 0}), facing ${facing}`,
      `Adjacent: ${adjacent.map(([label, y, x]) => `${label}:${describe(y, x)}`).join(", ")}`,
    ].join("\n");
  }

  clear(): void {
    this.maps.clear();
    this.turnCounter = 0;
  }

  importRecords(records: Iterable<MapRecord>): void {
    for (const incoming of records) {
      const existing = this.maps.get(incoming.mapId);
      if (existing === undefined) {
        const tiles = new Map(incoming.tiles);
        this.maps.set(incoming.mapId, { ...incoming, tiles, npcPositions: [], knownNpcs: new Map(incoming.knownNpcs) });
      } else {
        if (incoming.width > 0) {
          existing.width = incoming.width;
        }
        if (incoming.height > 0) {
          existing.height = incoming.height;
        }
        for (const [key, tile] of incoming.tiles) {
          existing.tiles.set(key, tile);
        }
      }
    }
  }

  exportRecords(): MapRecord[] {
    return [...this.maps.values()];
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  loadRecord(record: MapRecord): void {
    this.maps.set(record.mapId, {
      ...record,
      knownNpcs: new Map(record.knownNpcs),
    });
  }

  private getOrCreate(mapId: number): MapRecord {
    let record = this.maps.get(mapId);
    if (record === undefined) {
      record = { mapId, width: 0, height: 0, tiles: new Map(), npcPositions: [], knownNpcs: new Map() };
      this.maps.set(mapId, record);
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function classifyBlock(collision: TileCollisionData, _t0: number, _t1: number, t2: number, t3: number): ClassifiedTile {
  const lower = [classifyTile(collision, t2), classifyTile(collision, t3)];
  const features = [...new Set(lower.flatMap((tile) => tile.features))];
  const terrains = lower.map((tile) => tile.terrain);

  const bothPassable = terrains.every((t) => t === "walkable" || t === "grass");
  if (bothPassable) {
    return {
      terrain: terrains.includes("grass") ? "grass" : "walkable",
      features,
      tileId: t2,
    };
  }

  if (terrains.includes("water")) {
    return { terrain: "water", features, tileId: t2 };
  }

  return { terrain: "wall", features, tileId: t2 };
}

function tileChar(type: TileType): string {
  switch (type) {
    case "walkable": return ".";
    case "wall": return "#";
    case "grass": return '"';
    case "water": return "~";
    default: return "?";
  }
}

function tileTerrain(tile: RecordedTile): TileTerrain {
  return tile.terrain ?? tile.type ?? "wall";
}

function tileFeatures(tile: RecordedTile): readonly TileFeature[] {
  return tile.features ?? [];
}
