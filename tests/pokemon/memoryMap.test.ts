import { describe, expect, it } from "vitest";
import {
  HALL_OF_FAME_MAP_ID,
  RED_BLUE_MEMORY_MAP,
  wBattleMonHP,
  wBattleResult,
  wBattleType,
  wCurMap,
  wCurMapTileset,
  wCurMapHeight,
  wCurMapWidth,
  wCurrentMenuItem,
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
  wTileInFrontOfPlayer,
  wTileMap,
  wTileMapLength,
  wWarpEntries,
  wXBlockCoord,
  wXCoord,
  wYBlockCoord,
  wYCoord
} from "../../src/pokemon/memoryMap.js";

describe("Red/Blue memory map", () => {
  it("exports the researched international Red/Blue RAM addresses", () => {
    expect(RED_BLUE_MEMORY_MAP).toEqual({
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
      wOverworldMap: 0xc6e8,
      wOverworldMapMaxSize: 1300,
      wSpriteStateData1: 0xc100,
      wSpriteStateData2: 0xc200,
      SPRITE_COUNT: 16,
      SPRITE_STRUCT_SIZE: 0x10,
      wNumberOfWarps: 0xd3ae,
      wWarpEntries: 0xd3af,
      WARP_ENTRY_SIZE: 4,
      wTileInFrontOfPlayer: 0xcfc6,
      wTilePlayerStandingOn: 0xcf0e,
      wGrassRate: 0xd887,
      wWalkCounter: 0xcfc5,
      wJoyIgnore: 0xcd6b,
      wNumberOfSprites: 0xd4e1,
      wEventFlags: 0xd747,
      EVENT_GOT_POKEDEX: 0x25,
      EVENT_OAK_GOT_PARCEL: 0x38,
      EVENT_GOT_OAKS_PARCEL: 0x39,
      wPlayTimeHours: 0xda41,
      wPlayTimeMaxed: 0xda42,
      wPlayTimeMinutes: 0xda43,
      wPlayTimeSeconds: 0xda44,
      wPlayTimeFrames: 0xda45,
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
    });
  });

  it("exports each symbolic address directly", () => {
    expect(wIsInBattle).toBe(0xd057);
    expect(wBattleType).toBe(0xd05a);
    expect(wBattleMonHP).toBe(0xd015);
    expect(wEnemyMonHP).toBe(0xcfe6);
    expect(wBattleResult).toBe(0xcf0b);
    expect(wCurrentMenuItem).toBe(0xcc26);
    expect(wTileMap).toBe(0xc3a0);
    expect(wTileMapLength).toBe(360);
    expect(wNamingScreenNameLength).toBe(0xcee9);
    expect(wNamingScreenSubmitName).toBe(0xceea);
    expect(wNamingScreenType).toBe(0xd07d);
    expect(wSpritePlayerStateData1FacingDirection).toBe(0xc109);
    expect(wTextBoxID).toBe(0xd125);
    expect(wPartyCount).toBe(0xd163);
    expect(wPartyMon1HP).toBe(0xd16c);
    expect(wPartyMon1MaxHP).toBe(0xd18d);
    expect(wObtainedBadges).toBe(0xd356);
    expect(wCurMap).toBe(0xd35e);
    expect(wYCoord).toBe(0xd361);
    expect(wXCoord).toBe(0xd362);
    expect(wYBlockCoord).toBe(0xd363);
    expect(wXBlockCoord).toBe(0xd364);
    expect(wLetterPrintingDelayFlags).toBe(0xd358);
    expect(wCurMapTileset).toBe(0xd367);
    expect(wCurMapHeight).toBe(0xd368);
    expect(wCurMapWidth).toBe(0xd369);
    expect(wOverworldMap).toBe(0xc6e8);
    expect(wSpriteStateData1).toBe(0xc100);
    expect(wSpriteStateData2).toBe(0xc200);
    expect(wNumberOfWarps).toBe(0xd3ae);
    expect(wWarpEntries).toBe(0xd3af);
    expect(wTileInFrontOfPlayer).toBe(0xcfc6);
    expect(wNumberOfSprites).toBe(0xd4e1);
    expect(HALL_OF_FAME_MAP_ID).toBe(0x76);
  });
});
