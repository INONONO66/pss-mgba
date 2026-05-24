import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import { RED_BLUE_MEMORY_MAP } from "./memoryMap.js";
import { readMapLayout, type MapLayoutSnapshot } from "./MapLayout.js";
import { readSprites, type SpriteSnapshot } from "./SpriteReader.js";
import { readTileCollisionData, type TileCollisionData } from "./TilesetData.js";
import { readWarps, type WarpSnapshot } from "./WarpReader.js";
import { decodeGen1Text } from "./TextCodec.js";

type RamClient = Pick<MgbaHttpClient, "read8" | "read16" | "readRange">;

const map = RED_BLUE_MEMORY_MAP;

const NAMING_SCREEN_MARKERS = ["lower case", "UPPER CASE", "ED Mr."];

export type GameMode =
  | "title"
  | "overworld"
  | "dialog"
  | "battle"
  | "naming"
  | "menu";

export interface ModeFlags {
  readonly battle: number;
  readonly textBoxId: number;
  readonly letterDelay: number;
  readonly curMap: number;
  readonly yCoord: number;
  readonly xCoord: number;
  readonly partyCount: number;
  readonly walkCounter: number;
  readonly joyIgnore: number;
  readonly namingScreenType: number;
  readonly screenText: string;
}

export interface GameWorldSnapshot {
  readonly mode: GameMode;
  readonly modeFlags: ModeFlags;
  readonly tileMapBytes: Uint8Array;
  readonly mapLayout: MapLayoutSnapshot;
  readonly sprites: SpriteSnapshot;
  readonly warps: WarpSnapshot;
  readonly tileCollision: TileCollisionData;
  readonly playerCoords: { readonly y: number; readonly x: number };
  readonly tileInFront: number;
  readonly tileStandingOn: number;
  readonly grassRate: number;
}

export interface GameWorldReadOptions {
  readonly tileMapBytes?: Uint8Array;
}

interface ModeFlagsRead {
  readonly flags: ModeFlags;
  readonly tileMapBytes: Uint8Array;
}

async function readModeFlags(client: RamClient, options: GameWorldReadOptions = {}): Promise<ModeFlagsRead> {
  const tileMapPromise = options.tileMapBytes !== undefined
    ? Promise.resolve(options.tileMapBytes)
    : client.readRange(map.wTileMap, map.wTileMapLength);
  const [battle, textBoxId, letterDelay, curMap, coords, partyCount, walkCounter, joyIgnore, namingScreenType, tileMapBytes] = await Promise.all([
    client.read8(map.wIsInBattle),
    client.read8(map.wTextBoxID),
    client.read8(map.wLetterPrintingDelayFlags),
    client.read8(map.wCurMap),
    client.readRange(map.wYCoord, 2),
    client.read8(map.wPartyCount),
    client.read8(map.wWalkCounter),
    client.read8(map.wJoyIgnore),
    client.read8(map.wNamingScreenType),
    tileMapPromise,
  ]);

  return {
    flags: {
      battle,
      textBoxId,
      letterDelay,
      curMap,
      yCoord: coords[0],
      xCoord: coords[1],
      partyCount,
      walkCounter,
      joyIgnore,
      namingScreenType,
      screenText: decodeTileMapText(tileMapBytes),
    },
    tileMapBytes,
  };
}

function decodeTileMapText(bytes: Uint8Array): string {
  return decodeGen1Text(bytes);
}

function classifyMode(flags: ModeFlags): GameMode {
  if (isAllZeroState(flags)) return "title";
  if (flags.battle !== 0) return "battle";
  if (isNamingScreen(flags)) return "naming";
  if (isDialogActive(flags)) return "dialog";
  return "overworld";
}

function isDialogActive(flags: ModeFlags): boolean {
  // Red/Blue leaves stale text box style/delay values in WRAM while the player
  // is freely walking. Use input masking or visible decoded text as the active
  // dialog signal.
  return flags.joyIgnore !== 0 || (flags.textBoxId !== 0 && flags.screenText.length > 0);
}

function isNamingScreen(flags: ModeFlags): boolean {
  if (flags.namingScreenType === 0) return false;
  return NAMING_SCREEN_MARKERS.some((marker) => flags.screenText.includes(marker));
}

function isAllZeroState(flags: ModeFlags): boolean {
  return (
    flags.curMap === 0 &&
    flags.yCoord === 0 &&
    flags.xCoord === 0 &&
    flags.partyCount === 0 &&
    flags.battle === 0 &&
    flags.textBoxId === 0 &&
    flags.joyIgnore === 0 &&
    flags.walkCounter === 0
  );
}

export async function readGameWorld(client: RamClient, options: GameWorldReadOptions = {}): Promise<GameWorldSnapshot> {
  const { flags: modeFlags, tileMapBytes } = await readModeFlags(client, options);
  const mode = classifyMode(modeFlags);

  const emptySnapshot: GameWorldSnapshot = {
    mode,
    modeFlags,
    tileMapBytes,
    mapLayout: { mapId: modeFlags.curMap, tilesetId: 0, height: 0, width: 0, grid: [] },
    sprites: { player: undefined, npcs: [], spriteCount: 0 },
    warps: { warps: [], connections: { north: undefined, south: undefined, west: undefined, east: undefined } },
    tileCollision: { tilesetId: 0, walkableTiles: new Set(), grassTile: undefined },
    playerCoords: { y: modeFlags.yCoord, x: modeFlags.xCoord },
    tileInFront: 0,
    tileStandingOn: 0,
    grassRate: 0,
  };

  if (mode === "title" || mode === "naming") {
    return emptySnapshot;
  }

  const [mapLayout, sprites, warps, tileCollision, tileInFront, tileStandingOn, grassRate] = await Promise.all([
    readMapLayout(client),
    readSprites(client),
    readWarps(client),
    readTileCollisionData(client),
    client.read8(map.wTileInFrontOfPlayer),
    client.read8(map.wTilePlayerStandingOn),
    client.read8(map.wGrassRate),
  ]);

  return {
    mode,
    modeFlags,
    tileMapBytes,
    mapLayout,
    sprites,
    warps,
    tileCollision,
    playerCoords: { y: modeFlags.yCoord, x: modeFlags.xCoord },
    tileInFront,
    tileStandingOn,
    grassRate,
  };
}
