// International Pokémon Red/Blue WRAM symbols. Addresses are cross-checked
// against pret/pokered's WRAM layout and DataCrystal's RAM map; keep tests in
// tests/pokemon/memoryMap.test.ts in lock-step when changing these values.
export const RED_BLUE_MEMORY_MAP = {
  wIsInBattle: 0xd057,
  wBattleType: 0xd05a,
  wBattleMonHP: 0xd015,
  wEnemyMonHP: 0xcfe6,
  wBattleResult: 0xcf0b,
  wCurrentMenuItem: 0xcc26,
  wTileMap: 0xc3a0,
  wTileMapLength: 360,
  wNamingScreenNameLength: 0xcee9,
  wNamingScreenSubmitName: 0xceea,
  wNamingScreenType: 0xd07d,
  wSpritePlayerStateData1FacingDirection: 0xc109,
  wTextBoxID: 0xd125,
  wPlayerName: 0xd158,
  NAME_LENGTH: 11,
  wPartyCount: 0xd163,
  wPartySpecies: 0xd164,
  wPartyMons: 0xd16b,
  PARTY_LENGTH: 6,
  PARTYMON_STRUCT_LENGTH: 0x2c,
  wPartyMon1HP: 0xd16c,
  wPartyMon1MaxHP: 0xd18d,
  wPartyMonOT: 0xd273,
  wPartyMonNicks: 0xd2b5,
  wPokedexOwned: 0xd2f7,
  wPokedexSeen: 0xd30a,
  POKEDEX_FLAG_BYTES: 19,
  wNumBagItems: 0xd31d,
  wBagItems: 0xd31e,
  BAG_ITEM_CAPACITY: 20,
  wPlayerMoney: 0xd347,
  wRivalName: 0xd34a,
  wObtainedBadges: 0xd356,
  wCurMap: 0xd35e,
  wYCoord: 0xd361,
  wXCoord: 0xd362,
  wYBlockCoord: 0xd363,
  wXBlockCoord: 0xd364,
  wLetterPrintingDelayFlags: 0xd358,

  // map header (loaded when map changes)
  wCurMapTileset: 0xd367,
  wCurMapHeight: 0xd368,
  wCurMapWidth: 0xd369,
  wCurMapDataPtr: 0xd36a,
  wCurMapConnections: 0xd370,

  wNorthConnection: 0xd371,
  wSouthConnection: 0xd37c,
  wWestConnection: 0xd387,
  wEastConnection: 0xd392,
  CONNECTION_SIZE: 11,

  // overworld map block buffer
  wOverworldMap: 0xc6e8,
  wOverworldMapMaxSize: 1300,

  // sprite state tables (16 sprites × 0x10 bytes each)
  wSpriteStateData1: 0xc100,
  wSpriteStateData2: 0xc200,
  SPRITE_COUNT: 16,
  SPRITE_STRUCT_SIZE: 0x10,

  // warps
  wNumberOfWarps: 0xd3ae,
  wWarpEntries: 0xd3af,
  WARP_ENTRY_SIZE: 4,

  // misc overworld
  wTileInFrontOfPlayer: 0xcfc6,
  wTilePlayerStandingOn: 0xcf0e,
  wGrassRate: 0xd887,
  wWalkCounter: 0xcfc5,
  wJoyIgnore: 0xcd6b,
  wNumberOfSprites: 0xd4e1,

  // event flags
  wEventFlags: 0xd747,
  EVENT_GOT_POKEDEX: 0x25,
  EVENT_OAK_GOT_PARCEL: 0x38,
  EVENT_GOT_OAKS_PARCEL: 0x39,

  // play time
  wPlayTimeHours: 0xda41,
  wPlayTimeMaxed: 0xda42,
  wPlayTimeMinutes: 0xda43,
  wPlayTimeSeconds: 0xda44,
  wPlayTimeFrames: 0xda45,

  // current enemy battle mon
  wEnemyMon: 0xcfe5,
  wEnemyMonSpecies: 0xcfe5,
  wEnemyMonLevel: 0xcff3,
  wEnemyMonStatus: 0xcfe9,
  wEnemyMonType1: 0xcfea,
  wEnemyMonType2: 0xcfeb,
  wEnemyMonMoves: 0xcfed,
  wEnemyMonMaxHP: 0xcff4,
  wEnemyMonPP: 0xcffe,
  BATTLEMON_STRUCT_LENGTH: 0x1d,

  wTilesetBank: 0xd52b,
  wTilesetCollisionPtr: 0xd530,
  wTilesetGrassTile: 0xd535,
} as const;

export const HALL_OF_FAME_MAP_ID = 0x76;

export type RedBlueMemorySymbol = keyof typeof RED_BLUE_MEMORY_MAP;

export const wIsInBattle = RED_BLUE_MEMORY_MAP.wIsInBattle;
export const wBattleType = RED_BLUE_MEMORY_MAP.wBattleType;
export const wBattleMonHP = RED_BLUE_MEMORY_MAP.wBattleMonHP;
export const wEnemyMonHP = RED_BLUE_MEMORY_MAP.wEnemyMonHP;
export const wBattleResult = RED_BLUE_MEMORY_MAP.wBattleResult;
export const wCurrentMenuItem = RED_BLUE_MEMORY_MAP.wCurrentMenuItem;
export const wTileMap = RED_BLUE_MEMORY_MAP.wTileMap;
export const wTileMapLength = RED_BLUE_MEMORY_MAP.wTileMapLength;
export const wNamingScreenNameLength = RED_BLUE_MEMORY_MAP.wNamingScreenNameLength;
export const wNamingScreenSubmitName = RED_BLUE_MEMORY_MAP.wNamingScreenSubmitName;
export const wNamingScreenType = RED_BLUE_MEMORY_MAP.wNamingScreenType;
export const wSpritePlayerStateData1FacingDirection = RED_BLUE_MEMORY_MAP.wSpritePlayerStateData1FacingDirection;
export const wTextBoxID = RED_BLUE_MEMORY_MAP.wTextBoxID;
export const wPlayerName = RED_BLUE_MEMORY_MAP.wPlayerName;
export const wPartyCount = RED_BLUE_MEMORY_MAP.wPartyCount;
export const wPartySpecies = RED_BLUE_MEMORY_MAP.wPartySpecies;
export const wPartyMons = RED_BLUE_MEMORY_MAP.wPartyMons;
export const wPartyMon1HP = RED_BLUE_MEMORY_MAP.wPartyMon1HP;
export const wPartyMon1MaxHP = RED_BLUE_MEMORY_MAP.wPartyMon1MaxHP;
export const wPartyMonOT = RED_BLUE_MEMORY_MAP.wPartyMonOT;
export const wPartyMonNicks = RED_BLUE_MEMORY_MAP.wPartyMonNicks;
export const wPokedexOwned = RED_BLUE_MEMORY_MAP.wPokedexOwned;
export const wPokedexSeen = RED_BLUE_MEMORY_MAP.wPokedexSeen;
export const wNumBagItems = RED_BLUE_MEMORY_MAP.wNumBagItems;
export const wBagItems = RED_BLUE_MEMORY_MAP.wBagItems;
export const wPlayerMoney = RED_BLUE_MEMORY_MAP.wPlayerMoney;
export const wRivalName = RED_BLUE_MEMORY_MAP.wRivalName;
export const wObtainedBadges = RED_BLUE_MEMORY_MAP.wObtainedBadges;
export const wCurMap = RED_BLUE_MEMORY_MAP.wCurMap;
export const wYCoord = RED_BLUE_MEMORY_MAP.wYCoord;
export const wXCoord = RED_BLUE_MEMORY_MAP.wXCoord;
export const wYBlockCoord = RED_BLUE_MEMORY_MAP.wYBlockCoord;
export const wXBlockCoord = RED_BLUE_MEMORY_MAP.wXBlockCoord;
export const wLetterPrintingDelayFlags = RED_BLUE_MEMORY_MAP.wLetterPrintingDelayFlags;
export const wCurMapTileset = RED_BLUE_MEMORY_MAP.wCurMapTileset;
export const wCurMapHeight = RED_BLUE_MEMORY_MAP.wCurMapHeight;
export const wCurMapWidth = RED_BLUE_MEMORY_MAP.wCurMapWidth;
export const wOverworldMap = RED_BLUE_MEMORY_MAP.wOverworldMap;
export const wSpriteStateData1 = RED_BLUE_MEMORY_MAP.wSpriteStateData1;
export const wSpriteStateData2 = RED_BLUE_MEMORY_MAP.wSpriteStateData2;
export const wNumberOfWarps = RED_BLUE_MEMORY_MAP.wNumberOfWarps;
export const wWarpEntries = RED_BLUE_MEMORY_MAP.wWarpEntries;
export const wTileInFrontOfPlayer = RED_BLUE_MEMORY_MAP.wTileInFrontOfPlayer;
export const wNumberOfSprites = RED_BLUE_MEMORY_MAP.wNumberOfSprites;
export const wJoyIgnore = RED_BLUE_MEMORY_MAP.wJoyIgnore;
export const wEventFlags = RED_BLUE_MEMORY_MAP.wEventFlags;
export const wPlayTimeHours = RED_BLUE_MEMORY_MAP.wPlayTimeHours;
export const wEnemyMon = RED_BLUE_MEMORY_MAP.wEnemyMon;
export const wEnemyMonSpecies = RED_BLUE_MEMORY_MAP.wEnemyMonSpecies;
export const wEnemyMonLevel = RED_BLUE_MEMORY_MAP.wEnemyMonLevel;
export const wEnemyMonMoves = RED_BLUE_MEMORY_MAP.wEnemyMonMoves;
