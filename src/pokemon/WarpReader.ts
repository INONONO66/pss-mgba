import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

export interface WarpEntry {
  readonly y: number;
  readonly x: number;
  readonly destWarpId: number;
  readonly destMapId: number;
}

export interface MapConnection {
  readonly mapId: number;
  readonly stripOffset: number;
  readonly stripLength: number;
  readonly mapWidth: number;
}

export interface WarpSnapshot {
  readonly warps: readonly WarpEntry[];
  readonly connections: {
    readonly north: MapConnection | undefined;
    readonly south: MapConnection | undefined;
    readonly west: MapConnection | undefined;
    readonly east: MapConnection | undefined;
  };
}

function parseConnection(bytes: Uint8Array): MapConnection {
  return {
    mapId: bytes[0],
    stripOffset: bytes[3],
    stripLength: bytes[4],
    mapWidth: bytes[5],
  };
}

export async function readWarps(client: RamClient): Promise<WarpSnapshot> {
  const warpCount = await client.read8(map.wNumberOfWarps);
  const safeCount = Math.min(warpCount, 32);

  const warpData = safeCount > 0
    ? await client.readRange(map.wWarpEntries, safeCount * map.WARP_ENTRY_SIZE)
    : new Uint8Array(0);

  const warps: WarpEntry[] = [];
  for (let i = 0; i < safeCount; i++) {
    const off = i * map.WARP_ENTRY_SIZE;
    warps.push({
      y: warpData[off],
      x: warpData[off + 1],
      destWarpId: warpData[off + 2],
      destMapId: warpData[off + 3],
    });
  }

  const connByte = await client.read8(map.wCurMapConnections);
  const hasNorth = (connByte & 0x08) !== 0;
  const hasSouth = (connByte & 0x04) !== 0;
  const hasWest = (connByte & 0x02) !== 0;
  const hasEast = (connByte & 0x01) !== 0;

  const readConn = async (address: number): Promise<MapConnection> => {
    const bytes = await client.readRange(address, map.CONNECTION_SIZE);
    return parseConnection(bytes);
  };

  const [north, south, west, east] = await Promise.all([
    hasNorth ? readConn(map.wNorthConnection) : Promise.resolve(undefined),
    hasSouth ? readConn(map.wSouthConnection) : Promise.resolve(undefined),
    hasWest ? readConn(map.wWestConnection) : Promise.resolve(undefined),
    hasEast ? readConn(map.wEastConnection) : Promise.resolve(undefined),
  ]);

  return { warps, connections: { north, south, west, east } };
}
