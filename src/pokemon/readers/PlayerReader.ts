import { decodeBcd, decodeUnsignedByte } from "../decoders.js";
import { mapName } from "../PokemonCatalog.js";
import type { BadgeProgress, MapInfo, PlayerFacing, PlayerInfo, PokemonCoordinates } from "../PokemonTypes.js";
import type { RamClient } from "../RamClient.js";
import { readRangeExact } from "../RamClient.js";
import { decodeGen1Name } from "../TextCodec.js";
import { RED_BLUE_MEMORY_MAP } from "../memoryMap.js";

const map = RED_BLUE_MEMORY_MAP;

export async function readPlayerInfo(
  client: RamClient,
  position: PokemonCoordinates,
  facing: PlayerFacing,
  badges: BadgeProgress
): Promise<PlayerInfo> {
  const [playerName, rivalName, moneyBytes, playTime] = await Promise.all([
    readRangeExact(client, map.wPlayerName, map.NAME_LENGTH, "wPlayerName"),
    readRangeExact(client, map.wRivalName, map.NAME_LENGTH, "wRivalName"),
    readRangeExact(client, map.wPlayerMoney, 3, "wPlayerMoney"),
    readPlayTime(client),
  ]);

  return {
    name: decodeGen1Name(playerName),
    rivalName: decodeGen1Name(rivalName),
    money: decodeBcd(moneyBytes, "wPlayerMoney"),
    position,
    facing,
    badges,
    playTime,
  };
}

export async function readMapInfo(client: RamClient, mapId: number): Promise<MapInfo> {
  const [tilesetId, height, width] = await Promise.all([
    client.read8(map.wCurMapTileset),
    client.read8(map.wCurMapHeight),
    client.read8(map.wCurMapWidth),
  ]);

  return {
    mapId,
    mapName: mapName(mapId),
    tilesetId: decodeUnsignedByte(tilesetId, "wCurMapTileset") & 0x1f,
    width: decodeUnsignedByte(width, "wCurMapWidth"),
    height: decodeUnsignedByte(height, "wCurMapHeight"),
  };
}

async function readPlayTime(client: RamClient): Promise<string> {
  const bytes = await readRangeExact(client, map.wPlayTimeHours, 5, "wPlayTime");
  const hours = decodeUnsignedByte(bytes[0], "wPlayTimeHours");
  const maxed = decodeUnsignedByte(bytes[1], "wPlayTimeMaxed") !== 0;
  const minutes = decodeUnsignedByte(bytes[2], "wPlayTimeMinutes");
  const seconds = decodeUnsignedByte(bytes[3], "wPlayTimeSeconds");
  const frames = decodeUnsignedByte(bytes[4], "wPlayTimeFrames");

  const suffix = maxed ? "+" : "";
  return `${hours}${suffix}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${frames.toString().padStart(2, "0")}`;
}
