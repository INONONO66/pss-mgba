import {
  decodeBattleFlag,
  decodeBigEndianWord,
  decodeCoordinates,
  decodePartyCount,
  decodePlayerFacing,
  decodeUnsignedByte
} from "./decoders.js";
import { HarnessError } from "../shared/errors.js";
import { HALL_OF_FAME_MAP_ID, RED_BLUE_MEMORY_MAP } from "./memoryMap.js";
import type { BadgeProgress, BattleFlag, FullGameState, HitPoints, MenuTextState, PartySummary, PlayerFacing, PokemonCoordinates, PokemonGameState } from "./PokemonTypes.js";
import type { RamClient } from "./RamClient.js";
import { readRangeExact } from "./RamClient.js";
import { decodeGen1Text } from "./TextCodec.js";
import { readFullGameState } from "./readers/FullGameStateReader.js";

export type PokemonGameVersion = "red" | "blue";

export interface PokemonStateReaderOptions {
  readonly client: RamClient;
  readonly version: PokemonGameVersion;
}

export interface ReadFullStateOptions {
  readonly menuText?: MenuTextState;
}

export interface ReadMenuTextStateOptions {
  readonly tileMapBytes?: Uint8Array;
}

export interface PokemonBattleState {
  readonly flag: BattleFlag;
  readonly battleType: number;
  readonly battleResult: number;
  readonly battleMonHp: number;
  readonly enemyMonHp: number;
}

export interface PokemonGameStateSnapshot extends PokemonGameState {
  readonly battleState: PokemonBattleState;
  readonly wIsInBattle: number;
  readonly wBattleType: number;
  readonly wBattleResult: number;
  readonly wBattleMonHP: number;
  readonly wEnemyMonHP: number;
  readonly wPartyCount: number;
  readonly wObtainedBadges: number;
  readonly badgeCount: number;
  readonly badgesObtained: readonly boolean[];
  readonly hallOfFameComplete: boolean;
  readonly wPartyMon1HP?: number;
  readonly wPartyMon1MaxHP?: number;
  readonly wCurMap: number;
  readonly wYCoord: number;
  readonly wXCoord: number;
  readonly wYBlockCoord: number;
  readonly wXBlockCoord: number;
  readonly wSpritePlayerStateData1FacingDirection: number;
  readonly playerFacingDirection: string;
  readonly wCurrentMenuItem: number;
  readonly wNamingScreenNameLength: number;
  readonly wNamingScreenSubmitName: number;
  readonly wNamingScreenType: number;
  readonly wTextBoxID: number;
  readonly wLetterPrintingDelayFlags: number;
  readonly screenText: string;
  readonly screenTextKind: string;
  readonly mapId: number;
  readonly y: number;
  readonly x: number;
  readonly partyCount: number;
  readonly menuItem: number;
  readonly textBoxId: number;
  readonly letterDelayFlags: number;
}

const map = RED_BLUE_MEMORY_MAP;

export class PokemonStateReader {
  private readonly client: RamClient;
  readonly version: PokemonGameVersion;
  private lastTileMapBytes: Uint8Array | undefined;

  constructor(options: PokemonStateReaderOptions) {
    this.client = options.client;
    this.version = validateVersion(options.version);
  }

  async readState(): Promise<PokemonGameStateSnapshot> {
    const [battleState, coordinates, playerFacing, party, badges, menuText] = await Promise.all([
      this.readBattleState(),
      this.readOverworldState(),
      this.readPlayerFacingState(),
      this.readPartyState(),
      this.readBadgeState(),
      this.readMenuTextState()
    ]);

    return createSnapshot({ battleState, coordinates, playerFacing, party, badges, menuText });
  }

  async readFullState(options: ReadFullStateOptions = {}): Promise<FullGameState> {
    const [coordinates, playerFacing, badges, menuText] = await Promise.all([
      this.readOverworldState(),
      this.readPlayerFacingState(),
      this.readBadgeState(),
      options.menuText !== undefined ? Promise.resolve(options.menuText) : this.readMenuTextState()
    ]);

    return readFullGameState({
      client: this.client,
      coordinates,
      playerFacing,
      badges,
      menuText,
    });
  }

  async readOverworldState(): Promise<PokemonCoordinates> {
    const bytes = await this.readRangeExact(
      map.wLetterPrintingDelayFlags,
      map.wXBlockCoord - map.wLetterPrintingDelayFlags + 1,
      "overworldState"
    );

    return decodeCoordinates({
      mapId: byteAt(bytes, map.wCurMap - map.wLetterPrintingDelayFlags, "wCurMap"),
      y: byteAt(bytes, map.wYCoord - map.wLetterPrintingDelayFlags, "wYCoord"),
      x: byteAt(bytes, map.wXCoord - map.wLetterPrintingDelayFlags, "wXCoord"),
      yBlock: byteAt(bytes, map.wYBlockCoord - map.wLetterPrintingDelayFlags, "wYBlockCoord"),
      xBlock: byteAt(bytes, map.wXBlockCoord - map.wLetterPrintingDelayFlags, "wXBlockCoord")
    });
  }

  async readBattleState(): Promise<PokemonBattleState> {
    const [battleResult, enemyHpBytes, battleMonHpBytes, battleFlags] = await Promise.all([
      this.client.read8(map.wBattleResult),
      this.readRangeExact(map.wEnemyMonHP, 2, "wEnemyMonHP"),
      this.readRangeExact(map.wBattleMonHP, 2, "wBattleMonHP"),
      this.readRangeExact(map.wIsInBattle, map.wBattleType - map.wIsInBattle + 1, "battleFlags")
    ]);

    return {
      flag: decodeBattleFlag(byteAt(battleFlags, 0, "wIsInBattle")),
      battleType: decodeUnsignedByte(byteAt(battleFlags, map.wBattleType - map.wIsInBattle, "wBattleType"), "wBattleType"),
      battleResult: decodeUnsignedByte(battleResult, "wBattleResult"),
      battleMonHp: decodeBigEndianWord(
        byteAt(battleMonHpBytes, 0, "wBattleMonHP.lowByte"),
        byteAt(battleMonHpBytes, 1, "wBattleMonHP.highByte"),
        "wBattleMonHP"
      ),
      enemyMonHp: decodeBigEndianWord(
        byteAt(enemyHpBytes, 0, "wEnemyMonHP.lowByte"),
        byteAt(enemyHpBytes, 1, "wEnemyMonHP.highByte"),
        "wEnemyMonHP"
      )
    };
  }

  async readPlayerFacingState(): Promise<PlayerFacing> {
    return decodePlayerFacing(await this.client.read8(map.wSpritePlayerStateData1FacingDirection));
  }

  async readPartyState(): Promise<PartySummary> {
    const bytes = await this.readRangeExact(map.wPartyCount, map.wPartyMon1MaxHP - map.wPartyCount + 2, "partyState");
    const count = decodePartyCount(byteAt(bytes, 0, "wPartyCount"));

    if (count === 0) {
      return { count };
    }

    const currentHp = decodeBigEndianWord(
      byteAt(bytes, map.wPartyMon1HP - map.wPartyCount, "wPartyMon1HP.lowByte"),
      byteAt(bytes, map.wPartyMon1HP - map.wPartyCount + 1, "wPartyMon1HP.highByte"),
      "wPartyMon1HP"
    );
    const maxHp = decodeBigEndianWord(
      byteAt(bytes, map.wPartyMon1MaxHP - map.wPartyCount, "wPartyMon1MaxHP.lowByte"),
      byteAt(bytes, map.wPartyMon1MaxHP - map.wPartyCount + 1, "wPartyMon1MaxHP.highByte"),
      "wPartyMon1MaxHP"
    );

    if (currentHp === 0 && maxHp === 0) {
      return { count };
    }

    const firstPokemonHp = validatePartyHp({
      current: currentHp,
      max: maxHp
    });

    return { count, firstPokemonHp };
  }

  async readBadgeState(): Promise<BadgeProgress> {
    return decodeBadgeProgress(await this.client.read8(map.wObtainedBadges));
  }

  getLastTileMapBytes(): Uint8Array | undefined {
    return this.lastTileMapBytes === undefined ? undefined : new Uint8Array(this.lastTileMapBytes);
  }

  async readMenuTextState(options: ReadMenuTextStateOptions = {}): Promise<MenuTextState> {
    const tileMapPromise = options.tileMapBytes !== undefined
      ? Promise.resolve(options.tileMapBytes)
      : this.readRangeExact(map.wTileMap, map.wTileMapLength, "wTileMap");
    const [currentMenuItem, textBoxId, letterPrintingDelayFlags, tileMap, namingScreenNameLength, namingScreenSubmitName, namingScreenType] = await Promise.all([
      this.client.read8(map.wCurrentMenuItem),
      this.client.read8(map.wTextBoxID),
      this.client.read8(map.wLetterPrintingDelayFlags),
      tileMapPromise,
      this.client.read8(map.wNamingScreenNameLength),
      this.client.read8(map.wNamingScreenSubmitName),
      this.client.read8(map.wNamingScreenType)
    ]);

    this.lastTileMapBytes = new Uint8Array(tileMap);
    const screenText = decodeTileMapText(tileMap);

    return {
      currentMenuItem: decodeUnsignedByte(currentMenuItem, "wCurrentMenuItem"),
      textBoxId: decodeUnsignedByte(textBoxId, "wTextBoxID"),
      letterPrintingDelayFlags: decodeUnsignedByte(letterPrintingDelayFlags, "wLetterPrintingDelayFlags"),
      screenText,
      screenTextKind: classifyScreenText(screenText),
      namingScreenNameLength: decodeUnsignedByte(namingScreenNameLength, "wNamingScreenNameLength"),
      namingScreenSubmitName: decodeUnsignedByte(namingScreenSubmitName, "wNamingScreenSubmitName"),
      namingScreenType: decodeUnsignedByte(namingScreenType, "wNamingScreenType")
    };
  }

  private async readRangeExact(address: number, length: number, fieldName: string): Promise<Uint8Array> {
    return readRangeExact(this.client, address, length, fieldName);
  }
}

function createSnapshot(input: {
  battleState: PokemonBattleState;
  coordinates: PokemonCoordinates;
  playerFacing: PlayerFacing;
  party: PartySummary;
  badges: BadgeProgress;
  menuText: MenuTextState;
}): PokemonGameStateSnapshot {
  const { battleState, coordinates, playerFacing, party, badges, menuText } = input;

  return {
    battle: battleState.flag,
    battleState,
    coordinates,
    playerFacing,
    party,
    badges,
    menuText,
    wIsInBattle: battleState.flag.raw,
    wBattleType: battleState.battleType,
    wBattleResult: battleState.battleResult,
    wBattleMonHP: battleState.battleMonHp,
    wEnemyMonHP: battleState.enemyMonHp,
    wPartyCount: party.count,
    wObtainedBadges: badges.raw,
    badgeCount: badges.count,
    badgesObtained: badges.obtained,
    hallOfFameComplete: coordinates.mapId === HALL_OF_FAME_MAP_ID,
    wPartyMon1HP: party.firstPokemonHp?.current,
    wPartyMon1MaxHP: party.firstPokemonHp?.max,
    wCurMap: coordinates.mapId,
    wYCoord: coordinates.y,
    wXCoord: coordinates.x,
    wYBlockCoord: coordinates.yBlock,
    wXBlockCoord: coordinates.xBlock,
    wSpritePlayerStateData1FacingDirection: playerFacing.raw,
    playerFacingDirection: playerFacing.direction,
    wCurrentMenuItem: menuText.currentMenuItem,
    wNamingScreenNameLength: menuText.namingScreenNameLength,
    wNamingScreenSubmitName: menuText.namingScreenSubmitName,
    wNamingScreenType: menuText.namingScreenType,
    wTextBoxID: menuText.textBoxId,
    wLetterPrintingDelayFlags: menuText.letterPrintingDelayFlags,
    screenText: menuText.screenText,
    screenTextKind: menuText.screenTextKind,
    mapId: coordinates.mapId,
    y: coordinates.y,
    x: coordinates.x,
    partyCount: party.count,
    menuItem: menuText.currentMenuItem,
    textBoxId: menuText.textBoxId,
    letterDelayFlags: menuText.letterPrintingDelayFlags
  };
}

const BADGE_NAMES = ["Boulder", "Cascade", "Thunder", "Rainbow", "Soul", "Marsh", "Volcano", "Earth"] as const;

function decodeBadgeProgress(rawValue: number): BadgeProgress {
  const raw = decodeUnsignedByte(rawValue, "wObtainedBadges");
  const obtained = Array.from({ length: 8 }, (_value, index) => (raw & (1 << index)) !== 0);
  return {
    raw,
    count: obtained.filter(Boolean).length,
    obtained,
    names: obtained.map((has, i) => has ? BADGE_NAMES[i] : "").filter(Boolean),
  };
}

function decodeTileMapText(bytes: Uint8Array): string {
  return decodeGen1Text(bytes);
}

function classifyScreenText(screenText: string): MenuTextState["screenTextKind"] {
  if (screenText.length === 0) {
    return "none";
  }

  if (screenText.includes("Hello there") || screenText.includes("Welcome to") || screenText.includes("world of POKEMON")) {
    return "oak_intro";
  }

  if (screenText.includes("NEW NAME") || screenText.includes("ASH") || screenText.includes("GARY")) {
    return "default_name_menu";
  }

  if (screenText.includes("lower case") || screenText.includes("UPPER CASE")) {
    return "naming_screen";
  }

  return "overworld_text";
}

function validatePartyHp(hitPoints: Required<HitPoints>): Required<HitPoints> {
  if (hitPoints.max === 0 || hitPoints.current > hitPoints.max) {
    throw new HarnessError("INVALID_RAM_STATE", "Party Pokemon HP cannot exceed max HP", {
      context: { currentHp: hitPoints.current, maxHp: hitPoints.max }
    });
  }

  return hitPoints;
}

function validateVersion(version: PokemonGameVersion): PokemonGameVersion {
  if (version !== "red" && version !== "blue") {
    throw new HarnessError("INVALID_RAM_STATE", "PokemonStateReader only supports Pokemon Red and Blue RAM maps", {
      context: { version }
    });
  }

  return version;
}

function byteAt(bytes: Uint8Array, index: number, fieldName: string): number {
  return decodeUnsignedByte(bytes[index], fieldName);
}
