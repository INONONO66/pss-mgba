import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

export type TileType = "walkable" | "wall" | "grass";

export interface TileCollisionData {
  readonly tilesetId: number;
  readonly walkableTiles: ReadonlySet<number>;
  readonly grassTile: number | undefined;
}

export async function readTileCollisionData(client: RamClient): Promise<TileCollisionData> {
  const metadataLength = map.wTilesetGrassTile - map.wTilesetCollisionPtr + 1;
  const [tilesetId, metadata] = await Promise.all([
    client.read8(map.wCurMapTileset),
    client.readRange(map.wTilesetCollisionPtr, metadataLength),
  ]);

  const collPtrLo = metadata[0] ?? 0;
  const collPtrHi = metadata[1] ?? 0;
  const grassTileRaw = metadata[map.wTilesetGrassTile - map.wTilesetCollisionPtr] ?? 0xff;
  const collPtr = (collPtrHi << 8) | collPtrLo;
  const walkable: number[] = [];

  const collisionBytes = await client.readRange(collPtr, 64);
  for (const val of collisionBytes) {
    if (val === 0xff) break;
    walkable.push(val);
  }

  return {
    tilesetId,
    walkableTiles: new Set(walkable),
    grassTile: grassTileRaw === 0xff ? undefined : grassTileRaw,
  };
}

export function classifyTile(data: TileCollisionData, tileId: number): TileType {
  if (data.grassTile !== undefined && tileId === data.grassTile) return "grass";
  return data.walkableTiles.has(tileId) ? "walkable" : "wall";
}

export type BlockType = "unknown";

export function lookupBlockType(_tilesetId: number, _blockId: number): BlockType {
  return "unknown";
}
