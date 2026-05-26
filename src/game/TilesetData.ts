import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";
import { getTileFeatures, isWaterTile } from "./tilesetSpecialTiles.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

export type TileTerrain = "walkable" | "wall" | "grass" | "water";
export type TileFeature = "cuttable" | "ledge" | "counter" | "door" | "warp";

export interface ClassifiedTile {
  readonly terrain: TileTerrain;
  readonly features: readonly TileFeature[];
  readonly tileId: number;
}

export type TileType = "walkable" | "wall" | "grass" | "water";

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
  const collPtr = collPtrHi * 256 + collPtrLo;
  const walkable: number[] = [];

  const collisionBytes = await client.readRange(collPtr, 64);
  for (const val of collisionBytes) {
    if (val === 0xff) {
      break;
    }
    walkable.push(val);
  }

  return {
    tilesetId,
    walkableTiles: new Set(walkable),
    grassTile: grassTileRaw === 0xff ? undefined : grassTileRaw,
  };
}

export function classifyTile(data: TileCollisionData, tileId: number): ClassifiedTile {
  const features = getTileFeatures(data.tilesetId, tileId);

  let terrain: TileTerrain;
  if (isWaterTile(data.tilesetId, tileId)) {
    terrain = "water";
  } else if (data.grassTile !== undefined && tileId === data.grassTile) {
    terrain = "grass";
  } else if (data.walkableTiles.has(tileId)) {
    terrain = "walkable";
  } else {
    terrain = "wall";
  }

  return { terrain, features, tileId };
}
