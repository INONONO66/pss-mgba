import type { GameWorldSnapshot } from "./GameWorld.js";
import { classifyTile, type TileCollisionData, type TileType } from "./TilesetData.js";
import type { SpriteState } from "./SpriteReader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded tile in map-coordinate (block) space. */
export interface RecordedTile {
  readonly type: TileType;
  /** The raw tile IDs from the 2×2 screen-tile block (top-left, top-right, bottom-left, bottom-right). */
  readonly rawTiles: readonly [number, number, number, number];
}

/** Accumulated knowledge about a single map. */
export interface MapRecord {
  readonly mapId: number;
  /**
   * Map dimensions in **step coordinates** (wYCoord/wXCoord units).
   * wCurMapHeight/Width use the same 2×2-screen-tile block units as
   * wYCoord/wXCoord.
   * 0 until first observation.
   */
  width: number;
  height: number;
  /** Tile data keyed by "y,x" in map-block coordinates. */
  readonly tiles: Map<string, RecordedTile>;
  /** NPC positions observed on this map (last snapshot only). */
  npcPositions: ReadonlyArray<{ readonly y: number; readonly x: number }>;
}

/** Read-only view of a MapRecord for external consumers. */
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

/**
 * Accumulates tile data across multiple GameWorldSnapshots, building a
 * progressively more complete picture of each visited map.
 *
 * Coordinate system:
 *  - Map coordinates are in blocks (wYCoord / wXCoord units).
 *  - Each block corresponds to a 2×2 region of screen tiles (wTileMap).
 *  - The player's screen-tile position anchors the conversion.
 */
export class MapMemory {
  private readonly maps = new Map<number, MapRecord>();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Ingest a GameWorldSnapshot. Extracts the 20×18 screen tile buffer,
   * converts each 2×2 tile-block to map coordinates, and merges into the
   * stored map record.
   *
   * `screenTileBytes` must be the raw wTileMap buffer (360 bytes, 20×18).
   */
  update(world: GameWorldSnapshot, screenTileBytes: Uint8Array): MapMemoryUpdateResult {
    if (screenTileBytes.length < SCREEN_TILE_W * SCREEN_TILE_H) return { status: "skipped", reason: "short_tilemap" };
    if (world.mode === "title" || world.mode === "naming") return { status: "skipped", reason: "inactive_mode" };
    // Mid-walk scroll shifts wTileMap by partial rows → wrong coordinate mapping.
    if (world.modeFlags.walkCounter !== 0) return { status: "skipped", reason: "walking" };

    const player = world.sprites.player;
    if (player === undefined) return { status: "skipped", reason: "missing_player" };

    const mapId = world.mapLayout.mapId;
    const record = this.getOrCreate(mapId);

    if (world.mapLayout.width > 0) record.width = world.mapLayout.width;
    if (world.mapLayout.height > 0) record.height = world.mapLayout.height;

    // Player's screen-tile anchor.
    const playerScrY = Math.floor((player.yScreen + 4) / 8);
    const playerScrX = Math.floor(player.xScreen / 8);
    const playerMapY = world.playerCoords.y;
    const playerMapX = world.playerCoords.x;

    // Walk the screen-tile buffer in 2×2 blocks (each = 1 map block).
    // Only process blocks whose top-left corner aligns with an even
    // screen-tile offset relative to the player anchor.
    const startY = positiveModulo(playerScrY, 2);
    const startX = positiveModulo(playerScrX, 2);

    for (let sy = startY; sy < SCREEN_TILE_H - 1; sy += 2) {
      for (let sx = startX; sx < SCREEN_TILE_W - 1; sx += 2) {

        const t0 = screenTileBytes[sy * SCREEN_TILE_W + sx];
        const t1 = screenTileBytes[sy * SCREEN_TILE_W + sx + 1];
        const t2 = screenTileBytes[(sy + 1) * SCREEN_TILE_W + sx];
        const t3 = screenTileBytes[(sy + 1) * SCREEN_TILE_W + sx + 1];

        // Skip offscreen / border tiles.
        if (t0 === OFFSCREEN_TILE && t1 === OFFSCREEN_TILE && t2 === OFFSCREEN_TILE && t3 === OFFSCREEN_TILE) continue;

        const mapY = playerMapY + (sy - playerScrY) / 2;
        const mapX = playerMapX + (sx - playerScrX) / 2;

        // Discard out-of-bounds if dimensions are known.
        if (record.width > 0 && record.height > 0) {
          if (mapY < 0 || mapY >= record.height || mapX < 0 || mapX >= record.width) continue;
        }

        const type = classifyBlock(world.tileCollision, t0, t1, t2, t3);
        const key = `${mapY},${mapX}`;
        record.tiles.set(key, { type, rawTiles: [t0, t1, t2, t3] });
      }
    }

    // Update NPC positions (current snapshot only, not accumulated).
    record.npcPositions = world.sprites.npcs
      .filter((npc) => npc.onScreen)
      .map((npc) => ({ y: npc.mapY, x: npc.mapX }));

    return { status: "updated" };
  }

  /** Get the record for a map, or undefined if never visited. */
  get(mapId: number): MapRecord | undefined {
    return this.maps.get(mapId);
  }

  /** Get a read-only summary of a map record. */
  view(mapId: number): MapRecordView | undefined {
    const record = this.maps.get(mapId);
    if (record === undefined) return undefined;
    return {
      mapId: record.mapId,
      width: record.width,
      height: record.height,
      tileCount: record.tiles.size,
      npcPositions: record.npcPositions,
    };
  }

  /** List all visited map IDs. */
  visitedMaps(): number[] {
    return [...this.maps.keys()];
  }

  /** Total tiles recorded across all maps. */
  totalTiles(): number {
    let total = 0;
    for (const record of this.maps.values()) {
      total += record.tiles.size;
    }
    return total;
  }

  /**
   * Query the tile type at a specific map coordinate.
   * Returns undefined if the tile has not been observed yet.
   */
  tileAt(mapId: number, y: number, x: number): TileType | undefined {
    return this.maps.get(mapId)?.tiles.get(`${y},${x}`)?.type;
  }

  /**
   * Build a walkability grid for the given map, suitable for pathfinding.
   * Returns a 2D boolean array (true = walkable/grass, false = wall/unknown).
   * Requires map dimensions to be known.
   *
   * NPC positions from the latest snapshot are marked as non-walkable.
   */
  walkabilityGrid(mapId: number): { grid: boolean[][]; width: number; height: number } | undefined {
    const record = this.maps.get(mapId);
    if (record === undefined || record.width === 0 || record.height === 0) return undefined;

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
        // Unknown tiles are treated as non-walkable (conservative).
        row.push(tile !== undefined && tile.type !== "wall");
      }
      grid.push(row);
    }

    return { grid, width: record.width, height: record.height };
  }

  /**
   * Render an ASCII representation of the known map for debugging.
   * `@` = player position, `N` = NPC, `.` = walkable, `"` = grass,
   * `#` = wall, `?` = unknown.
   */
  renderAscii(mapId: number, playerY?: number, playerX?: number): string {
    const record = this.maps.get(mapId);
    if (record === undefined) return "(no data)";
    if (record.width === 0 || record.height === 0) return "(dimensions unknown)";

    const npcSet = new Set(record.npcPositions.map((p) => `${p.y},${p.x}`));
    const lines: string[] = [];

    // X-axis header
    lines.push("   " + Array.from({ length: record.width }, (_, i) => (i % 10).toString()).join(""));

    for (let y = 0; y < record.height; y++) {
      let line = y.toString().padStart(2, " ") + " ";
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

  /** Clear all recorded data. */
  clear(): void {
    this.maps.clear();
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

/**
 * Classify a 2×2 tile block. A block is "grass" if any tile is grass,
 * "walkable" if all non-grass tiles are walkable, otherwise "wall".
 */
function classifyBlock(collision: TileCollisionData, t0: number, t1: number, t2: number, t3: number): TileType {
  const types = [
    classifyTile(collision, t0),
    classifyTile(collision, t1),
    classifyTile(collision, t2),
    classifyTile(collision, t3),
  ];

  if (types.includes("grass")) return "grass";
  if (types.every((t) => t === "walkable" || t === "grass")) return "walkable";
  return "wall";
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function tileChar(type: TileType): string {
  switch (type) {
    case "walkable": return ".";
    case "wall": return "#";
    case "grass": return '"';
  }
}
