import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";
import { lookupBlockType, type BlockType } from "./TilesetData.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;
const MAP_BORDER_PADDING = 3;

export interface MapCell {
  readonly blockId: number;
  readonly type: BlockType;
}

export interface MapLayoutSnapshot {
  readonly mapId: number;
  readonly tilesetId: number;
  readonly height: number;
  readonly width: number;
  readonly grid: readonly (readonly MapCell[])[];
}

export async function readMapLayout(client: RamClient): Promise<MapLayoutSnapshot> {
  const [rawTileset, height, width, mapId] = await Promise.all([
    client.read8(map.wCurMapTileset),
    client.read8(map.wCurMapHeight),
    client.read8(map.wCurMapWidth),
    client.read8(map.wCurMap),
  ]);
  const tilesetId = rawTileset & 0x1f;

  const stride = width + MAP_BORDER_PADDING * 2;
  const totalRows = height + MAP_BORDER_PADDING * 2;
  const bufferSize = Math.min(stride * totalRows, map.wOverworldMapMaxSize);
  const raw = await client.readRange(map.wOverworldMap, bufferSize);

  const grid: MapCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: MapCell[] = [];
    for (let x = 0; x < width; x++) {
      const offset = (y + MAP_BORDER_PADDING) * stride + (x + MAP_BORDER_PADDING);
      const blockId = offset < raw.length ? raw[offset] : 0;
      row.push({ blockId, type: lookupBlockType(tilesetId, blockId) });
    }
    grid.push(row);
  }

  return { mapId, tilesetId, height, width, grid };
}
