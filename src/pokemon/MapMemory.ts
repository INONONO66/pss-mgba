import type { GameWorldSnapshot } from "./GameWorld.js";
import { classifyTile, type TileCollisionData, type TileType } from "./TilesetData.js";
import { mapName } from "./PokemonCatalog.js";
import type { WarpEntry } from "./WarpReader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordedTile {
  readonly type: TileType;
  readonly tileId: number;
}

export interface MapRecord {
  readonly mapId: number;
  width: number;
  height: number;
  readonly tiles: Map<string, RecordedTile>;
  npcPositions: ReadonlyArray<{ readonly y: number; readonly x: number }>;
}

export interface MapRecordView {
  readonly mapId: number;
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly npcPositions: ReadonlyArray<{ readonly y: number; readonly x: number }>;
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

        if (t0 === OFFSCREEN_TILE && t1 === OFFSCREEN_TILE && t2 === OFFSCREEN_TILE && t3 === OFFSCREEN_TILE) {
          continue;
        }

        const blockY = playerBlockY + (sy - playerBlockScrY) / 2;
        const blockX = playerBlockX + (sx - playerBlockScrX) / 2;

        if (record.width > 0 && record.height > 0) {
          if (blockY < 0 || blockY >= record.height || blockX < 0 || blockX >= record.width) {
            continue;
          }
        }

        const type = classifyBlock(world.tileCollision, t0, t1, t2, t3);
        const key = `${blockY},${blockX}`;
        record.tiles.set(key, { type, tileId: t0 });
      }
    }

    record.npcPositions = world.sprites.npcs
      .filter((npc) => npc.onScreen)
      .map((npc) => ({ y: npc.mapY, x: npc.mapX }));

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
    return this.maps.get(mapId)?.tiles.get(`${y},${x}`)?.type;
  }

  walkabilityGrid(mapId: number): { grid: boolean[][]; width: number; height: number } | undefined {
    const record = this.maps.get(mapId);
    if (record === undefined || record.width === 0 || record.height === 0) {
      return undefined;
    }

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
        row.push(tile !== undefined && tile.type !== "wall");
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

    const npcSet = new Set(record.npcPositions.map((p) => `${p.y},${p.x}`));
    const lines: string[] = [];

    lines.push(`   ${Array.from({ length: record.width }, (_, i) => (i % 10).toString()).join("")}`);

    for (let y = 0; y < record.height; y++) {
      let line = `${y.toString().padStart(2, " ")} `;
      for (let x = 0; x < record.width; x++) {
        const key = `${y},${x}`;
        if (playerY === y && playerX === x) {
          line += "@";
        } else if (npcSet.has(key)) {
          line += "N";
        } else {
          const tile = record.tiles.get(key);
          if (tile === undefined) {
            line += "?";
          } else {
            line += tileChar(tile.type);
          }
        }
      }
      lines.push(line);
    }

    lines.push("");
    lines.push(`  Legend: .=walkable #=wall "=grass ?=unknown @=player N=NPC`);
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

    const npcSet = new Set(record.npcPositions.map((p) => `${p.y},${p.x}`));
    const warpSet = new Set((warps ?? []).map((warp) => `${warp.y},${warp.x}`));
    const lines: string[] = [];

    lines.push(`=== CURRENT MAP: ${mapName(mapId)} (map ${mapId}), ${record.width}x${record.height}, explored ${this.exploredPercent(mapId)}% ===`);
    lines.push(`   ${Array.from({ length: record.width }, (_, i) => (i % 10).toString()).join("")}`);

    for (let y = 0; y < record.height; y++) {
      let line = `${y.toString().padStart(2, " ")} `;
      for (let x = 0; x < record.width; x++) {
        const key = `${y},${x}`;
        if (playerY === y && playerX === x) {
          line += "@";
        } else if (npcSet.has(key)) {
          line += "N";
        } else if (warpSet.has(key)) {
          line += "W";
        } else {
          const tile = record.tiles.get(key);
          line += tile === undefined ? "?" : tileChar(tile.type);
        }
      }
      lines.push(line);
    }

    lines.push("");
    lines.push(`  Legend: .=walkable #=wall "=grass ?=unknown @=player N=NPC W=warp`);
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
      return tile.type === "wall" ? "wall" : "open";
    };

    return [
      `Position: (${playerX ?? 0},${playerY ?? 0}), facing ${facing}`,
      `Adjacent: ${adjacent.map(([label, y, x]) => `${label}:${describe(y, x)}`).join(", ")}`,
    ].join("\n");
  }

  clear(): void {
    this.maps.clear();
  }

  importRecords(records: Iterable<MapRecord>): void {
    for (const incoming of records) {
      const existing = this.maps.get(incoming.mapId);
      if (existing === undefined) {
        const tiles = new Map(incoming.tiles);
        this.maps.set(incoming.mapId, { ...incoming, tiles, npcPositions: [] });
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

  private getOrCreate(mapId: number): MapRecord {
    let record = this.maps.get(mapId);
    if (record === undefined) {
      record = { mapId, width: 0, height: 0, tiles: new Map(), npcPositions: [] };
      this.maps.set(mapId, record);
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyBlock(collision: TileCollisionData, t0: number, t1: number, t2: number, t3: number): TileType {
  const types = [
    classifyTile(collision, t0),
    classifyTile(collision, t1),
    classifyTile(collision, t2),
    classifyTile(collision, t3),
  ];

  if (types.includes("grass")) {
    return "grass";
  }
  if (types.some((t) => t === "walkable")) {
    return "walkable";
  }
  return "wall";
}

function tileChar(type: TileType): string {
  switch (type) {
    case "walkable": return ".";
    case "wall": return "#";
    case "grass": return '"';
  }
}
