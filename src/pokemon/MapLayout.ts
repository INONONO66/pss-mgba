import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";
type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

export interface MapLayoutSnapshot {
  readonly mapId: number;
  readonly tilesetId: number;
  readonly height: number;
  readonly width: number;
}

export async function readMapLayout(client: RamClient): Promise<MapLayoutSnapshot> {
  const [rawTileset, height, width, mapId] = await Promise.all([
    client.read8(map.wCurMapTileset),
    client.read8(map.wCurMapHeight),
    client.read8(map.wCurMapWidth),
    client.read8(map.wCurMap),
  ]);
  const tilesetId = rawTileset & 0x1f;

  return { mapId, tilesetId, height, width };
}
