import { describe, expect, it } from "vitest";
import { FullGameDetector, HALL_OF_FAME_MAP_ID, type FullGameObservableState } from "../../src/pokemon/FullGameDetector.js";

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
