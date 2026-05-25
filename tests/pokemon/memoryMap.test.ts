import { describe, expect, it } from "vitest";
import {
  loadMemoryProfile,
  REQUIRED_RED_BLUE_CONSTANTS,
  REQUIRED_RED_BLUE_MEMORY_SYMBOLS,
  validateMemoryProfile,
} from "../../src/pokemon/memory-profile.js";
import {
  HALL_OF_FAME_MAP_ID,
  RED_BLUE_MEMORY_MAP,
  wBattleMonHP,
  wBattleResult,
  wBattleType,
  wCurMap,
  wCurMapHeight,
  wCurMapTileset,
  wCurMapWidth,
  wCurrentMenuItem,
  wBoxItems,
  wEnemyMonHP,
  wIsInBattle,
  wLetterPrintingDelayFlags,
  wNamingScreenNameLength,
  wNamingScreenSubmitName,
  wNamingScreenType,
  wNumberOfSprites,
  wNumberOfWarps,
  wObtainedBadges,
  wOverworldMap,
  wPartyCount,
  wPartyMon1HP,
  wPartyMon1MaxHP,
  wSpritePlayerStateData1FacingDirection,
  wSpriteStateData1,
  wSpriteStateData2,
  wTextBoxID,
  wTextProgress,
  wTileInFrontOfPlayer,
  wTileMap,
  wTileMapLength,
  wNumBoxItems,
  wWarpEntries,
  wXBlockCoord,
  wXCoord,
  wYBlockCoord,
  wYCoord,
} from "../../src/pokemon/memoryMap.js";

const MALFORMED_MEMORY_MAP_PATTERN = /memoryMap\.wCurMap/;

describe("Red/Blue memory map", () => {
  it("exports the researched international Red/Blue RAM addresses", () => {
    expect(RED_BLUE_MEMORY_MAP).toEqual({
      wIsInBattle: 0xd0_57,
      wBattleType: 0xd0_5a,
      wBattleMonHP: 0xd0_15,
      wEnemyMonHP: 0xcf_e6,
      wBattleResult: 0xcf_0b,
      wCurrentMenuItem: 0xcc_26,
      wTileMap: 0xc3_a0,
      wTileMapLength: 360,
      wNamingScreenNameLength: 0xce_e9,
      wNamingScreenSubmitName: 0xce_ea,
      wNamingScreenType: 0xd0_7d,
      wSpritePlayerStateData1FacingDirection: 0xc1_09,
      wTextBoxID: 0xd1_25,
      wPlayerName: 0xd1_58,
      NAME_LENGTH: 11,
      wPartyCount: 0xd1_63,
      wPartySpecies: 0xd1_64,
      wPartyMons: 0xd1_6b,
      PARTY_LENGTH: 6,
      PARTYMON_STRUCT_LENGTH: 0x2c,
      wPartyMon1HP: 0xd1_6c,
      wPartyMon1MaxHP: 0xd1_8d,
      wPartyMonOT: 0xd2_73,
      wPartyMonNicks: 0xd2_b5,
      wPokedexOwned: 0xd2_f7,
      wPokedexSeen: 0xd3_0a,
      POKEDEX_FLAG_BYTES: 19,
      wNumBagItems: 0xd3_1d,
      wBagItems: 0xd3_1e,
      wNumBoxItems: 0xd5_3a,
      wBoxItems: 0xd5_3b,
      BAG_ITEM_CAPACITY: 20,
      wPlayerMoney: 0xd3_47,
      wRivalName: 0xd3_4a,
      wObtainedBadges: 0xd3_56,
      wCurMap: 0xd3_5e,
      wTextProgress: 0xc4_f2,
      wYCoord: 0xd3_61,
      wXCoord: 0xd3_62,
      wYBlockCoord: 0xd3_63,
      wXBlockCoord: 0xd3_64,
      wLetterPrintingDelayFlags: 0xd3_58,
      wCurMapTileset: 0xd3_67,
      wCurMapHeight: 0xd3_68,
      wCurMapWidth: 0xd3_69,
      wCurMapDataPtr: 0xd3_6a,
      wCurMapConnections: 0xd3_70,
      wNorthConnection: 0xd3_71,
      wSouthConnection: 0xd3_7c,
      wWestConnection: 0xd3_87,
      wEastConnection: 0xd3_92,
      CONNECTION_SIZE: 11,
      wOverworldMap: 0xc6_e8,
      wOverworldMapMaxSize: 1300,
      wSpriteStateData1: 0xc1_00,
      wSpriteStateData2: 0xc2_00,
      SPRITE_COUNT: 16,
      SPRITE_STRUCT_SIZE: 0x10,
      wNumberOfWarps: 0xd3_ae,
      wWarpEntries: 0xd3_af,
      WARP_ENTRY_SIZE: 4,
      wTileInFrontOfPlayer: 0xcf_c6,
      wTilePlayerStandingOn: 0xcf_0e,
      wGrassRate: 0xd8_87,
      wWalkCounter: 0xcf_c5,
      wJoyIgnore: 0xcd_6b,
      wNumberOfSprites: 0xd4_e1,
      wEventFlags: 0xd7_47,
      EVENT_GOT_POKEDEX: 0x25,
      EVENT_OAK_GOT_PARCEL: 0x38,
      EVENT_GOT_OAKS_PARCEL: 0x39,
      wPlayTimeHours: 0xda_41,
      wPlayTimeMaxed: 0xda_42,
      wPlayTimeMinutes: 0xda_43,
      wPlayTimeSeconds: 0xda_44,
      wPlayTimeFrames: 0xda_45,
      wEnemyMon: 0xcf_e5,
      wEnemyMonSpecies: 0xcf_e5,
      wEnemyMonLevel: 0xcf_f3,
      wEnemyMonStatus: 0xcf_e9,
      wEnemyMonType1: 0xcf_ea,
      wEnemyMonType2: 0xcf_eb,
      wEnemyMonMoves: 0xcf_ed,
      wEnemyMonMaxHP: 0xcf_f4,
      wEnemyMonPP: 0xcf_fe,
      BATTLEMON_STRUCT_LENGTH: 0x1d,
      wTilesetBank: 0xd5_2b,
      wTilesetCollisionPtr: 0xd5_30,
      wTilesetGrassTile: 0xd5_35,
    });
  });

  it("loads every Red/Blue memory symbol from the JSON profile", () => {
    const profile = loadMemoryProfile(
      new URL(
        "../../src/pokemon/data/red-blue-memory-profile.json",
        import.meta.url
      )
    );

    expect(profile.id).toBe("pokemon-red-blue-international");
    expect(profile.memoryMap).toEqual(RED_BLUE_MEMORY_MAP);
    expect(profile.constants.HALL_OF_FAME_MAP_ID).toBe(HALL_OF_FAME_MAP_ID);
    expect(Object.keys(profile.constants).sort()).toEqual(
      [...REQUIRED_RED_BLUE_CONSTANTS].sort()
    );
    expect(Object.keys(profile.memoryMap).sort()).toEqual(
      [...REQUIRED_RED_BLUE_MEMORY_SYMBOLS].sort()
    );
  });

  it("rejects malformed memory profiles before use", () => {
    expect(() =>
      validateMemoryProfile({
        id: "bad",
        name: "Bad",
        memoryMap: { wCurMap: -1 },
        constants: {},
      })
    ).toThrow(MALFORMED_MEMORY_MAP_PATTERN);
    expect(() =>
      validateMemoryProfile({
        id: "bad",
        name: "Bad",
        memoryMap: {},
        constants: { HALL_OF_FAME_MAP_ID: 0x76 },
      })
    ).not.toThrow();
    expect(() =>
      validateMemoryProfile({
        id: "bad",
        name: "Bad",
        memoryMap: { wCurMap: 3.14 },
        constants: { HALL_OF_FAME_MAP_ID: 0x76 },
      })
    ).toThrow(MALFORMED_MEMORY_MAP_PATTERN);
  });

  it("keeps a direct compatibility export for each memory-map key", async () => {
    const exported = (await import("../../src/pokemon/memoryMap.js")) as Record<
      string,
      unknown
    >;

    for (const symbol of REQUIRED_RED_BLUE_MEMORY_SYMBOLS) {
      expect(exported[symbol]).toBe(RED_BLUE_MEMORY_MAP[symbol]);
    }
  });

  it("exports each symbolic address directly", () => {
    expect(wIsInBattle).toBe(0xd0_57);
    expect(wBattleType).toBe(0xd0_5a);
    expect(wBattleMonHP).toBe(0xd0_15);
    expect(wEnemyMonHP).toBe(0xcf_e6);
    expect(wBattleResult).toBe(0xcf_0b);
    expect(wCurrentMenuItem).toBe(0xcc_26);
    expect(wNumBoxItems).toBe(0xd5_3a);
    expect(wBoxItems).toBe(0xd5_3b);
    expect(wTileMap).toBe(0xc3_a0);
    expect(wTileMapLength).toBe(360);
    expect(wNamingScreenNameLength).toBe(0xce_e9);
    expect(wNamingScreenSubmitName).toBe(0xce_ea);
    expect(wNamingScreenType).toBe(0xd0_7d);
    expect(wSpritePlayerStateData1FacingDirection).toBe(0xc1_09);
    expect(wTextBoxID).toBe(0xd1_25);
    expect(wPartyCount).toBe(0xd1_63);
    expect(wPartyMon1HP).toBe(0xd1_6c);
    expect(wPartyMon1MaxHP).toBe(0xd1_8d);
    expect(wObtainedBadges).toBe(0xd3_56);
    expect(wCurMap).toBe(0xd3_5e);
    expect(wTextProgress).toBe(0xc4_f2);
    expect(wYCoord).toBe(0xd3_61);
    expect(wXCoord).toBe(0xd3_62);
    expect(wYBlockCoord).toBe(0xd3_63);
    expect(wXBlockCoord).toBe(0xd3_64);
    expect(wLetterPrintingDelayFlags).toBe(0xd3_58);
    expect(wCurMapTileset).toBe(0xd3_67);
    expect(wCurMapHeight).toBe(0xd3_68);
    expect(wCurMapWidth).toBe(0xd3_69);
    expect(wOverworldMap).toBe(0xc6_e8);
    expect(wSpriteStateData1).toBe(0xc1_00);
    expect(wSpriteStateData2).toBe(0xc2_00);
    expect(wNumberOfWarps).toBe(0xd3_ae);
    expect(wWarpEntries).toBe(0xd3_af);
    expect(wTileInFrontOfPlayer).toBe(0xcf_c6);
    expect(wNumberOfSprites).toBe(0xd4_e1);
    expect(HALL_OF_FAME_MAP_ID).toBe(0x76);
  });
});
