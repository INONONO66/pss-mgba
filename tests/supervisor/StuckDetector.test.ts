import { describe, expect, it } from "vitest";
import type { FullGameState } from "../../src/game/PokemonTypes.js";
import { analyzeStuckSignals, analyzeStuckSignalsV2, StuckDetector } from "../../src/supervisor/index.js";

describe("StuckDetector", () => {
  it("produces location signature from flat state", () => {
    const detector = new StuckDetector();

    const detection = detector.analyze({
      fullState: fullState(),
      recentStates: Array.from({ length: 6 }, (_value, step) => ({ step, mapId: 38, y: 3, x: 3 })),
    });

    expect(detection.stableContextSignature).toContain("loc=38:3:3");
  });

  it("produces location signature from nested FullGameState", () => {
    const detector = new StuckDetector();

    const detection = detector.analyze({
      fullState: fullState(),
      recentStates: Array.from({ length: 6 }, (_value, step) => nestedState(step)),
    });

    expect(detection.stableContextSignature).toContain("loc=38:3:3");
  });

  it("detects stuck with nested FullGameState objects", () => {
    const recentActions = Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => nestedState(step));

    const detection = analyzeStuckSignals({
      fullState: fullState(),
      recentActions,
      recentStates,
    });

    expect(detection).toMatchObject({
      stuck: true,
      repeatedActionCount: 5,
      stableLocationCount: 6,
    });
  });

  it("does not detect stuck in battle mode", () => {
    const recentActions = Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => nestedState(step));

    const detection = analyzeStuckSignals({
      fullState: fullState({ battle: { inBattle: true, type: "wild" } }),
      recentActions,
      recentStates,
    });

    expect(detection.stuck).toBe(false);
  });

  it("does not detect stuck in dialog mode", () => {
    const recentActions = Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => nestedState(step));

    const detection = analyzeStuckSignals({
      fullState: fullState({ dialog: { active: true, textBoxId: 1, letterPrintingDelayFlags: 1, joyIgnore: 0xff } }),
      recentActions,
      recentStates,
    });

    expect(detection.stuck).toBe(false);
  });
});

describe("StuckDetector v2", () => {
  it("detects locationLoop when oscillating between 2 maps", () => {
    const detector = new StuckDetector();

    const detection = detector.analyzeV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([0, 12, 0, 12, 0, 12]),
    });

    expect(detection.levels.locationLoop).toBe(true);
  });

  it("does not detect locationLoop with 4+ unique maps", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([0, 1, 2, 3, 4, 5]),
    });

    expect(detection.levels.locationLoop).toBe(false);
  });

  it("detects noProgress when step far from lastProgressStep", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      step: 50,
      detectorStatus: { lastProgressStep: 10 },
    });

    expect(detection.levels.noProgress).toBe(true);
  });

  it("does not detect noProgress when recent progress", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      step: 15,
      detectorStatus: { lastProgressStep: 10 },
    });

    expect(detection.levels.noProgress).toBe(false);
  });

  it("detects backtrackLoop with A-B-A-B pattern", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([38, 12, 38, 12, 38]),
    });

    expect(detection.levels.backtrackLoop).toBe(true);
  });

  it("severity is none when no levels triggered", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([0, 1, 2, 3, 4, 5]),
      step: 15,
      detectorStatus: { lastProgressStep: 10 },
    });

    expect(detection.severity).toBe("none");
  });

  it("severity is soft when one level triggered", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([0, 1, 2, 0, 1, 2]),
    });

    expect(detection.levels).toMatchObject({
      actionLoop: false,
      locationLoop: true,
      noProgress: false,
      backtrackLoop: false,
    });
    expect(detection.severity).toBe("soft");
  });

  it("severity is hard when two+ levels triggered", () => {
    const detection = analyzeStuckSignalsV2({
      fullState: fullState(),
      recentStates: statesWithMapIds([38, 12, 38, 12, 38, 12]),
    });

    expect(detection.levels.locationLoop).toBe(true);
    expect(detection.levels.backtrackLoop).toBe(true);
    expect(detection.severity).toBe("hard");
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

function nestedState(step: number) {
  return {
    ...fullState(),
    step,
  };
}

function statesWithMapIds(mapIds: readonly number[]) {
  return mapIds.map((mapId, step) => ({ step, mapId, y: 3, x: 3 }));
}
