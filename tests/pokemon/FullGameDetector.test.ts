import { describe, expect, it } from "vitest";
import { FullGameDetector, HALL_OF_FAME_MAP_ID, toObservableState, type FullGameObservableState } from "../../src/game/FullGameDetector.js";
import type { FullGameState } from "../../src/game/PokemonTypes.js";

function state(overrides: Partial<FullGameObservableState> = {}): FullGameObservableState {
  return {
    wCurMap: 0,
    wYCoord: 6,
    wXCoord: 5,
    wPartyCount: 0,
    wIsInBattle: 0,
    wObtainedBadges: 0,
    badgeCount: 0,
    hallOfFameComplete: false,
    ...overrides
  };
}

describe("FullGameDetector", () => {
  describe("toObservableState", () => {
    it("converts nested FullGameState to flat FullGameObservableState", () => {
      expect(toObservableState(fullState())).toEqual({
        wCurMap: 38,
        mapId: 38,
        wYCoord: 3,
        y: 3,
        wXCoord: 3,
        x: 3,
        wPartyCount: 1,
        partyCount: 1,
        wIsInBattle: 0,
        isInBattle: false,
        wObtainedBadges: 0,
        badgeCount: 0,
        badgesObtained: [false, false, false, false, false, false, false, false],
        hallOfFameComplete: false,
      });
    });

    it("maps battle type to wIsInBattle correctly", () => {
      expect(toObservableState(fullState({ battle: { inBattle: false, type: "none" } })).wIsInBattle).toBe(0);
      expect(toObservableState(fullState({ battle: { inBattle: true, type: "wild" } })).wIsInBattle).toBe(1);
      expect(toObservableState(fullState({ battle: { inBattle: true, type: "trainer" } })).wIsInBattle).toBe(2);
      expect(toObservableState(fullState({ battle: { inBattle: false, type: "lost" } })).wIsInBattle).toBe(0);
    });

    it("derives hallOfFameComplete from map id 0x76", () => {
      expect(toObservableState(fullState({ map: { ...fullState().map, mapId: HALL_OF_FAME_MAP_ID } })).hallOfFameComplete).toBe(true);
    });

    it("maps badge bitmask and count", () => {
      const observable = toObservableState(fullState({
        player: {
          ...fullState().player,
          badges: {
            raw: 3,
            count: 2,
            obtained: [true, true, false, false, false, false, false, false],
            names: [],
          },
        },
        flags: {
          ...fullState().flags,
          badges: {
            raw: 3,
            count: 2,
            obtained: [true, true, false, false, false, false, false, false],
            names: [],
          },
        },
      }));

      expect(observable.wObtainedBadges).toBe(3);
      expect(observable.badgeCount).toBe(2);
      expect(observable.badgesObtained).toEqual([true, true, false, false, false, false, false, false]);
    });
  });

  it("tracks Stage 1 and badge progress without completing before Hall of Fame", () => {
    const detector = new FullGameDetector();

    detector.update(state());
    detector.update(state({ wPartyCount: 1 }));
    detector.update(state({ wPartyCount: 1 }));
    detector.update(state({ wPartyCount: 1, wIsInBattle: 1 }));
    const rivalExited = detector.update(state({ wPartyCount: 1, wIsInBattle: 0 }));
    const allBadges = detector.update(state({ wPartyCount: 1, wObtainedBadges: 0xff, badgeCount: 8 }));

    expect(rivalExited.checkpoints.rivalBattleExited).toBe(true);
    expect(rivalExited.status).toBe("running");
    expect(allBadges.checkpoints.allBadgesObtained).toBe(true);
    expect(allBadges.checkpoints.completed).toBe(false);
    expect(allBadges.status).toBe("running");
  });

  it("requires two Hall of Fame observations before completing", () => {
    const mapDetector = new FullGameDetector();
    const mapStatus = mapDetector.update(state({ wCurMap: HALL_OF_FAME_MAP_ID, mapId: HALL_OF_FAME_MAP_ID }));
    const stableMapStatus = mapDetector.update(state({ wCurMap: HALL_OF_FAME_MAP_ID, mapId: HALL_OF_FAME_MAP_ID }));

    expect(mapStatus.status).toBe("running");
    expect(mapStatus.checkpoints.hallOfFameObserved).toBe(true);
    expect(mapStatus.checkpoints.hallOfFameCompleted).toBe(false);
    expect(mapStatus.checkpoints.completed).toBe(false);
    expect(stableMapStatus.status).toBe("completed");
    expect(stableMapStatus.checkpoints.hallOfFameObserved).toBe(true);
    expect(stableMapStatus.checkpoints.hallOfFameCompleted).toBe(true);
    expect(stableMapStatus.checkpoints.completed).toBe(true);

    const flagDetector = new FullGameDetector();
    const flagStatus = flagDetector.update(state({ hallOfFameComplete: true }));
    const stableFlagStatus = flagDetector.update(state({ hallOfFameComplete: true }));

    expect(flagStatus.status).toBe("running");
    expect(stableFlagStatus.status).toBe("completed");
    expect(stableFlagStatus.checkpointEvidence.map((entry) => entry.checkpoint)).toContain("hallOfFameObserved");
    expect(stableFlagStatus.checkpointEvidence.map((entry) => entry.checkpoint)).toContain("hallOfFameCompleted");
  });

  it("does not complete from a one-frame Hall of Fame false positive", () => {
    const detector = new FullGameDetector();
    const first = detector.update(state({ wCurMap: HALL_OF_FAME_MAP_ID, mapId: HALL_OF_FAME_MAP_ID }));
    const returned = detector.update(state({ wCurMap: 1, mapId: 1 }));

    expect(first.checkpoints.hallOfFameObserved).toBe(true);
    expect(first.status).toBe("running");
    expect(returned.checkpoints.hallOfFameCompleted).toBe(false);
    expect(returned.checkpoints.completed).toBe(false);
    expect(returned.status).toBe("running");
  });

  it("eventually completes only on stable Hall of Fame map observation or derived completion flag", () => {
    const mapDetector = new FullGameDetector();
    mapDetector.update(state({ wCurMap: HALL_OF_FAME_MAP_ID, mapId: HALL_OF_FAME_MAP_ID }));
    const mapStatus = mapDetector.update(state({ wCurMap: HALL_OF_FAME_MAP_ID, mapId: HALL_OF_FAME_MAP_ID }));

    expect(mapStatus.status).toBe("completed");
    expect(mapStatus.checkpoints.hallOfFameCompleted).toBe(true);
    expect(mapStatus.checkpoints.completed).toBe(true);

    const flagDetector = new FullGameDetector();
    flagDetector.update(state({ hallOfFameComplete: true }));
    const flagStatus = flagDetector.update(state({ hallOfFameComplete: true }));

    expect(flagStatus.status).toBe("completed");
    expect(flagStatus.checkpointEvidence.map((entry) => entry.checkpoint)).toContain("hallOfFameCompleted");
  });
});

function fullState(overrides: Partial<FullGameState> = {}): FullGameState {
  return {
    player: {
      name: "RED",
      rivalName: "BLUE",
      money: 3000,
      position: { mapId: 38, y: 3, x: 3, yBlock: 1, xBlock: 1 },
      facing: { raw: 8, direction: "left" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "1:38:18.22",
    },
    map: { mapId: 38, mapName: "Reds House 2f", tilesetId: 4, width: 4, height: 4 },
    party: {
      count: 1,
      members: [{
        slot: 0,
        speciesId: 4,
        species: "Charmander",
        nickname: "CHAR",
        level: 5,
        hp: 18,
        maxHp: 20,
        status: "OK",
        types: ["Fire", "Fire"],
        moves: [{ id: 33, name: "Tackle", pp: 35, ppUp: 0 }],
        stats: { attack: 11, defense: 10, speed: 12, special: 11 },
        experience: 135,
      }],
    },
    bag: [{ id: 20, name: "Potion", quantity: 1 }],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 0, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
    },
    menuText: {
      currentMenuItem: 0,
      textBoxId: 0,
      letterPrintingDelayFlags: 0,
      screenText: "",
      screenTextKind: "none",
      namingScreenNameLength: 0,
      namingScreenSubmitName: 0,
      namingScreenType: 0,
    },
    ...overrides,
  };
}
