import { describe, expect, it } from "vitest";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";
import { buildPokemonSupervisorPlan, renderSupervisorPlan } from "../../src/supervisor/index.js";

describe("PokemonSupervisor", () => {
  it("prioritizes an active battle and cites usable move context", () => {
    const plan = buildPokemonSupervisorPlan({
      step: 12,
      fullState: fullState({
        battle: {
          inBattle: true,
          type: "wild",
          enemy: {
            speciesId: 16,
            species: "Pidgey",
            level: 3,
            hp: 9,
            maxHp: 12,
            status: "OK",
            types: ["Normal", "Flying"],
            moves: [],
          },
        }
      })
    });

    expect(plan.assessment.state).toBe("progressing");
    expect(plan.activeGoal).toMatchObject({
      id: "win-current-battle",
      kind: "win-battle",
      title: "Win the current battle",
    });
    expect(plan.guidance.join("\n")).toContain("Tackle");
    expect(plan.citations).toEqual(expect.arrayContaining(["battle=wild", "party=1"]));
  });

  it("detects repeated inputs at a stable location and emits recovery guidance", () => {
    const recentActions = Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => ({ step, mapId: 38, y: 3, x: 3 }));

    const plan = buildPokemonSupervisorPlan({
      step: 20,
      fullState: fullState(),
      recentActions,
      recentStates,
    });

    expect(plan.assessment).toMatchObject({
      state: "stuck",
      repeatedActionCount: 5,
      stableLocationCount: 6,
    });
    expect(plan.activeGoal.kind).toBe("recover-from-loop");
    expect(plan.guidance.join("\n")).toContain("different action category");
    expect(plan.avoid.join("\n")).toContain("Do not repeat the same input");
  });

  it("surfaces stale map warnings without discarding the active story goal", () => {
    const plan = buildPokemonSupervisorPlan({
      fullState: fullState({ party: { count: 0, members: [] } }),
      mapFresh: false,
      mapStateWarning: "Map context reused; latest map update skipped: walking",
    });

    expect(plan.activeGoal).toMatchObject({
      id: "obtain-first-pokemon",
      kind: "advance-story",
    });
    expect(plan.assessment.reasons.join("\n")).toContain("walking");
    expect(plan.guidance.join("\n")).toContain("Treat spatial guidance as uncertain");
  });

  it("prioritizes naming screens before generic dialog handling", () => {
    const plan = buildPokemonSupervisorPlan({
      fullState: fullState({
        dialog: { active: true, textBoxId: 1, letterPrintingDelayFlags: 1, joyIgnore: 0xff },
        menuText: {
          ...fullState().menuText,
          screenText: "lower case UPPER CASE",
          screenTextKind: "naming_screen",
          namingScreenType: 1,
        },
      })
    });

    expect(plan.activeGoal).toMatchObject({
      id: "complete-naming",
      kind: "complete-naming",
      title: "Complete the naming prompt",
    });
  });

  it("falls back to generic dialog only when not in a naming screen", () => {
    const plan = buildPokemonSupervisorPlan({
      fullState: fullState({
        dialog: { active: true, textBoxId: 1, letterPrintingDelayFlags: 1, joyIgnore: 0xff },
        menuText: {
          ...fullState().menuText,
          screenText: "Hello there!",
          screenTextKind: "oak_intro",
        },
      })
    });

    expect(plan.activeGoal.kind).toBe("clear-dialog");
  });

  it("does not let stable battle coordinates preempt the battle goal", () => {
    const recentActions = Array.from({ length: 6 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => ({
      step,
      mapId: 38,
      y: 3,
      x: 3,
      wIsInBattle: 1,
      wEnemyMonHP: 12,
      wPartyMon1HP: 18,
    }));

    const plan = buildPokemonSupervisorPlan({
      fullState: fullState({
        battle: {
          inBattle: true,
          type: "wild",
          enemy: {
            speciesId: 16,
            species: "Pidgey",
            level: 3,
            hp: 12,
            maxHp: 12,
            status: "OK",
            types: ["Normal", "Flying"],
            moves: [],
          },
        }
      }),
      recentActions,
      recentStates,
    });

    expect(plan.assessment.state).toBe("progressing");
    expect(plan.activeGoal.kind).toBe("win-battle");
  });

  it("does not let stable dialog coordinates preempt the dialog goal", () => {
    const recentActions = Array.from({ length: 6 }, () => ({ action: { type: "press", button: "A", frames: 5 } }));
    const recentStates = Array.from({ length: 6 }, (_value, step) => ({
      step,
      mapId: 38,
      y: 3,
      x: 3,
      wIsInBattle: 0,
      wTextBoxID: 1,
      screenTextKind: "overworld_text",
      screenText: "Hello",
    }));

    const plan = buildPokemonSupervisorPlan({
      fullState: fullState({
        dialog: { active: true, textBoxId: 1, letterPrintingDelayFlags: 1, joyIgnore: 0xff },
        menuText: {
          ...fullState().menuText,
          screenText: "Hello",
          screenTextKind: "overworld_text",
        },
      }),
      recentActions,
      recentStates,
    });

    expect(plan.assessment.state).toBe("progressing");
    expect(plan.activeGoal.kind).toBe("clear-dialog");
  });

  it("marks only the selected goal active", () => {
    const plan = buildPokemonSupervisorPlan({ fullState: fullState() });

    expect(plan.activeGoal.status).toBe("active");
    expect(plan.goals.filter((goal) => goal.status === "active")).toHaveLength(1);
    expect(plan.goals.filter((goal) => goal.id !== plan.activeGoal.id).every((goal) => goal.status === "pending")).toBe(true);
  });

  it("renders compact human-readable guidance without route scripts", () => {
    const plan = buildPokemonSupervisorPlan({
      step: 30,
      fullState: fullState({ flags: { ...fullState().flags, hasOaksParcel: true, deliveredOaksParcel: false } }),
    });

    const rendered = renderSupervisorPlan(plan);

    expect(rendered).toContain("Supervisor v1");
    expect(rendered).toContain("Active goal:");
    expect(rendered).toContain("Deliver the held story item");
    expect(rendered).toContain("Citations:");
    expect(rendered).toContain("Do not follow a memorized route script");
    expect(rendered).not.toContain("Route 1");
    expect(rendered).not.toContain("step 1");
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
      }]
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
