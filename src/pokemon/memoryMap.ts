// International Pokémon Red/Blue WRAM symbols. Addresses are loaded from a
// conservative JSON profile so future game profiles can be added without
// replacing the compatibility exports used throughout the harness.
import {
  assertRequiredMemorySymbols,
  assertRequiredProfileConstants,
  loadMemoryProfile,
  REQUIRED_RED_BLUE_CONSTANTS,
  REQUIRED_RED_BLUE_MEMORY_SYMBOLS,
  type RequiredRedBlueConstant,
  type RequiredRedBlueMemorySymbol,
} from "./memory-profile.js";

const redBlueMemoryProfile = loadMemoryProfile(
  new URL("./data/red-blue-memory-profile.json", import.meta.url)
);
assertRequiredMemorySymbols(
  redBlueMemoryProfile,
  REQUIRED_RED_BLUE_MEMORY_SYMBOLS,
  "red-blue-memory-profile.json"
);
assertRequiredProfileConstants(
  redBlueMemoryProfile,
  REQUIRED_RED_BLUE_CONSTANTS,
  "red-blue-memory-profile.json"
);

export const RED_BLUE_MEMORY_MAP = redBlueMemoryProfile.memoryMap as Readonly<
  Record<RequiredRedBlueMemorySymbol, number>
>;

const RED_BLUE_PROFILE_CONSTANTS = redBlueMemoryProfile.constants as Readonly<
  Record<RequiredRedBlueConstant, number>
>;
export const HALL_OF_FAME_MAP_ID =
  RED_BLUE_PROFILE_CONSTANTS.HALL_OF_FAME_MAP_ID;

export type RedBlueMemorySymbol = keyof typeof RED_BLUE_MEMORY_MAP;

export const wIsInBattle = RED_BLUE_MEMORY_MAP.wIsInBattle;
export const wBattleType = RED_BLUE_MEMORY_MAP.wBattleType;
export const wBattleMonHP = RED_BLUE_MEMORY_MAP.wBattleMonHP;
export const wEnemyMonHP = RED_BLUE_MEMORY_MAP.wEnemyMonHP;
export const wBattleResult = RED_BLUE_MEMORY_MAP.wBattleResult;
export const wCurrentMenuItem = RED_BLUE_MEMORY_MAP.wCurrentMenuItem;
export const wTileMap = RED_BLUE_MEMORY_MAP.wTileMap;
export const wTileMapLength = RED_BLUE_MEMORY_MAP.wTileMapLength;
export const wNamingScreenNameLength =
  RED_BLUE_MEMORY_MAP.wNamingScreenNameLength;
export const wNamingScreenSubmitName =
  RED_BLUE_MEMORY_MAP.wNamingScreenSubmitName;
export const wNamingScreenType = RED_BLUE_MEMORY_MAP.wNamingScreenType;
export const wSpritePlayerStateData1FacingDirection =
  RED_BLUE_MEMORY_MAP.wSpritePlayerStateData1FacingDirection;
export const wTextBoxID = RED_BLUE_MEMORY_MAP.wTextBoxID;
export const wPlayerName = RED_BLUE_MEMORY_MAP.wPlayerName;
export const NAME_LENGTH = RED_BLUE_MEMORY_MAP.NAME_LENGTH;
export const wPartyCount = RED_BLUE_MEMORY_MAP.wPartyCount;
export const wPartySpecies = RED_BLUE_MEMORY_MAP.wPartySpecies;
export const wPartyMons = RED_BLUE_MEMORY_MAP.wPartyMons;
export const PARTY_LENGTH = RED_BLUE_MEMORY_MAP.PARTY_LENGTH;
export const PARTYMON_STRUCT_LENGTH =
  RED_BLUE_MEMORY_MAP.PARTYMON_STRUCT_LENGTH;
export const wPartyMon1HP = RED_BLUE_MEMORY_MAP.wPartyMon1HP;
export const wPartyMon1MaxHP = RED_BLUE_MEMORY_MAP.wPartyMon1MaxHP;
export const wPartyMonOT = RED_BLUE_MEMORY_MAP.wPartyMonOT;
export const wPartyMonNicks = RED_BLUE_MEMORY_MAP.wPartyMonNicks;
export const wPokedexOwned = RED_BLUE_MEMORY_MAP.wPokedexOwned;
export const wPokedexSeen = RED_BLUE_MEMORY_MAP.wPokedexSeen;
export const POKEDEX_FLAG_BYTES = RED_BLUE_MEMORY_MAP.POKEDEX_FLAG_BYTES;
export const wNumBagItems = RED_BLUE_MEMORY_MAP.wNumBagItems;
export const wBagItems = RED_BLUE_MEMORY_MAP.wBagItems;
export const wNumBoxItems = RED_BLUE_MEMORY_MAP.wNumBoxItems;
export const wBoxItems = RED_BLUE_MEMORY_MAP.wBoxItems;
export const BAG_ITEM_CAPACITY = RED_BLUE_MEMORY_MAP.BAG_ITEM_CAPACITY;
export const wPlayerMoney = RED_BLUE_MEMORY_MAP.wPlayerMoney;
export const wRivalName = RED_BLUE_MEMORY_MAP.wRivalName;
export const wObtainedBadges = RED_BLUE_MEMORY_MAP.wObtainedBadges;
export const wCurMap = RED_BLUE_MEMORY_MAP.wCurMap;
export const wTextProgress = RED_BLUE_MEMORY_MAP.wTextProgress;
export const wYCoord = RED_BLUE_MEMORY_MAP.wYCoord;
export const wXCoord = RED_BLUE_MEMORY_MAP.wXCoord;
export const wYBlockCoord = RED_BLUE_MEMORY_MAP.wYBlockCoord;
export const wXBlockCoord = RED_BLUE_MEMORY_MAP.wXBlockCoord;
export const wLetterPrintingDelayFlags =
  RED_BLUE_MEMORY_MAP.wLetterPrintingDelayFlags;
export const wCurMapTileset = RED_BLUE_MEMORY_MAP.wCurMapTileset;
export const wCurMapHeight = RED_BLUE_MEMORY_MAP.wCurMapHeight;
export const wCurMapWidth = RED_BLUE_MEMORY_MAP.wCurMapWidth;
export const wCurMapDataPtr = RED_BLUE_MEMORY_MAP.wCurMapDataPtr;
export const wCurMapConnections = RED_BLUE_MEMORY_MAP.wCurMapConnections;
export const wNorthConnection = RED_BLUE_MEMORY_MAP.wNorthConnection;
export const wSouthConnection = RED_BLUE_MEMORY_MAP.wSouthConnection;
export const wWestConnection = RED_BLUE_MEMORY_MAP.wWestConnection;
export const wEastConnection = RED_BLUE_MEMORY_MAP.wEastConnection;
export const CONNECTION_SIZE = RED_BLUE_MEMORY_MAP.CONNECTION_SIZE;
export const wOverworldMap = RED_BLUE_MEMORY_MAP.wOverworldMap;
export const wOverworldMapMaxSize = RED_BLUE_MEMORY_MAP.wOverworldMapMaxSize;
export const wSpriteStateData1 = RED_BLUE_MEMORY_MAP.wSpriteStateData1;
export const wSpriteStateData2 = RED_BLUE_MEMORY_MAP.wSpriteStateData2;
export const SPRITE_COUNT = RED_BLUE_MEMORY_MAP.SPRITE_COUNT;
export const SPRITE_STRUCT_SIZE = RED_BLUE_MEMORY_MAP.SPRITE_STRUCT_SIZE;
export const wNumberOfWarps = RED_BLUE_MEMORY_MAP.wNumberOfWarps;
export const wWarpEntries = RED_BLUE_MEMORY_MAP.wWarpEntries;
export const WARP_ENTRY_SIZE = RED_BLUE_MEMORY_MAP.WARP_ENTRY_SIZE;
export const wTileInFrontOfPlayer = RED_BLUE_MEMORY_MAP.wTileInFrontOfPlayer;
export const wTilePlayerStandingOn = RED_BLUE_MEMORY_MAP.wTilePlayerStandingOn;
export const wGrassRate = RED_BLUE_MEMORY_MAP.wGrassRate;
export const wWalkCounter = RED_BLUE_MEMORY_MAP.wWalkCounter;
export const wJoyIgnore = RED_BLUE_MEMORY_MAP.wJoyIgnore;
export const wNumberOfSprites = RED_BLUE_MEMORY_MAP.wNumberOfSprites;
export const wEventFlags = RED_BLUE_MEMORY_MAP.wEventFlags;
export const EVENT_GOT_POKEDEX = RED_BLUE_MEMORY_MAP.EVENT_GOT_POKEDEX;
export const EVENT_OAK_GOT_PARCEL = RED_BLUE_MEMORY_MAP.EVENT_OAK_GOT_PARCEL;
export const EVENT_GOT_OAKS_PARCEL = RED_BLUE_MEMORY_MAP.EVENT_GOT_OAKS_PARCEL;
export const wPlayTimeHours = RED_BLUE_MEMORY_MAP.wPlayTimeHours;
export const wPlayTimeMaxed = RED_BLUE_MEMORY_MAP.wPlayTimeMaxed;
export const wPlayTimeMinutes = RED_BLUE_MEMORY_MAP.wPlayTimeMinutes;
export const wPlayTimeSeconds = RED_BLUE_MEMORY_MAP.wPlayTimeSeconds;
export const wPlayTimeFrames = RED_BLUE_MEMORY_MAP.wPlayTimeFrames;
export const wEnemyMon = RED_BLUE_MEMORY_MAP.wEnemyMon;
export const wEnemyMonSpecies = RED_BLUE_MEMORY_MAP.wEnemyMonSpecies;
export const wEnemyMonLevel = RED_BLUE_MEMORY_MAP.wEnemyMonLevel;
export const wEnemyMonStatus = RED_BLUE_MEMORY_MAP.wEnemyMonStatus;
export const wEnemyMonType1 = RED_BLUE_MEMORY_MAP.wEnemyMonType1;
export const wEnemyMonType2 = RED_BLUE_MEMORY_MAP.wEnemyMonType2;
export const wEnemyMonMoves = RED_BLUE_MEMORY_MAP.wEnemyMonMoves;
export const wEnemyMonMaxHP = RED_BLUE_MEMORY_MAP.wEnemyMonMaxHP;
export const wEnemyMonPP = RED_BLUE_MEMORY_MAP.wEnemyMonPP;
export const BATTLEMON_STRUCT_LENGTH =
  RED_BLUE_MEMORY_MAP.BATTLEMON_STRUCT_LENGTH;
export const wTilesetBank = RED_BLUE_MEMORY_MAP.wTilesetBank;
export const wTilesetCollisionPtr = RED_BLUE_MEMORY_MAP.wTilesetCollisionPtr;
export const wTilesetGrassTile = RED_BLUE_MEMORY_MAP.wTilesetGrassTile;
