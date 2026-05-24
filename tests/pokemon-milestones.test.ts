import { describe, expect, it } from "vitest";
import {
  PokemonMilestoneTracker,
  scorePokemonMilestone,
} from "../src/pokemon-milestones";
import type { PokemonStateObservation } from "../src/pokemon-state";

const overworldState: PokemonStateObservation = {
  battle: false,
  battleResult: 0,
  battleType: 0,
  dialogueLike: "visual-fallback",
  direction: "down",
  mapId: 0,
  menuLike: "visual-fallback",
  position: {
    x: 4,
    y: 6,
  },
  readStatus: "available",
};

describe("Pokemon milestone scoring", () => {
  it("scores a handled title or menu state without claiming overworld progress", () => {
    expect(
      scorePokemonMilestone({ state: { ...overworldState, menuLike: true } })
    ).toBe("title-menu-handled");
  });

  it("scores player control from available overworld RAM state", () => {
    expect(scorePokemonMilestone({ state: overworldState })).toBe(
      "player-control-reached"
    );
  });

  it("scores the first map transition from a changed map id", () => {
    expect(
      scorePokemonMilestone(
        { state: { ...overworldState, mapId: 1 } },
        overworldState
      )
    ).toBe("first-map-transition");
  });

  it("scores completed dialogue only after a dialogue-like state clears", () => {
    expect(
      scorePokemonMilestone(
        { state: overworldState },
        { ...overworldState, dialogueLike: true }
      )
    ).toBe("first-dialogue-completed");
  });

  it("scores detected and completed battles conservatively", () => {
    const battleState = {
      ...overworldState,
      battle: true,
      battleType: 1,
    } satisfies PokemonStateObservation;

    expect(scorePokemonMilestone({ state: battleState }, overworldState)).toBe(
      "first-battle-detected"
    );
    expect(scorePokemonMilestone({ state: overworldState }, battleState)).toBe(
      "first-battle-completed"
    );
  });

  it("keeps run milestone state monotonic across lower or unknown observations", () => {
    const tracker = new PokemonMilestoneTracker();

    expect(tracker.observe({ state: overworldState })).toEqual({
      current: "player-control-reached",
      furthest: "player-control-reached",
    });
    expect(
      tracker.observe({
        state: { ...overworldState, battle: true, battleType: 1 },
      })
    ).toEqual({
      current: "first-battle-detected",
      furthest: "first-battle-detected",
    });
    expect(tracker.observe({ state: overworldState })).toEqual({
      current: "first-battle-completed",
      furthest: "first-battle-completed",
    });
    expect(
      tracker.observe({ state: { ...overworldState, menuLike: true } })
    ).toEqual({
      current: "first-battle-completed",
      furthest: "first-battle-completed",
    });
    expect(tracker.observe({ state: unavailableState() })).toEqual({
      current: "first-battle-completed",
      furthest: "first-battle-completed",
    });
  });

  it("does not fabricate progress when RAM is unavailable", () => {
    expect(scorePokemonMilestone({ state: unavailableState() })).toBeNull();
  });

  it("does not fabricate progress when map or position is missing", () => {
    expect(
      scorePokemonMilestone({ state: { ...overworldState, mapId: null } })
    ).toBeNull();
    expect(
      scorePokemonMilestone({
        state: { ...overworldState, position: { x: null, y: 6 } },
      })
    ).toBeNull();
  });

  it("does not score screenshot/status-only fallback without usable RAM", () => {
    expect(
      scorePokemonMilestone({
        status: {
          gameCode: "DMG-AR",
          gameTitle: "PKMN RED ST",
        },
      })
    ).toBeNull();
  });
});

function unavailableState(): PokemonStateObservation {
  return {
    ...overworldState,
    direction: "unknown",
    mapId: null,
    position: {
      x: null,
      y: null,
    },
    readStatus: "unavailable",
  };
}
