import { describe, expect, it } from "vitest";
import type { FullGameState } from "../../src/game/PokemonTypes.js";
import { SupervisorOrchestrator } from "../../src/supervisor/index.js";

describe("SupervisorOrchestrator", () => {
  it("constructs with valid config", () => {
    expect(() => new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" })).not.toThrow();
  });

  it("update() returns a valid SupervisorPlan", () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    const plan = orchestrator.update({ step: 1, fullState: fullState() });

    expect(plan).toMatchObject({
      version: 1,
      assessment: expect.objectContaining({ state: expect.any(String) }),
      activeGoal: expect.objectContaining({ status: "active" }),
    });
    expect(plan.goals.length).toBeGreaterThan(0);
    expect(plan.guidance.length).toBeGreaterThan(0);
  });

  it("getAdviserHint() returns undefined when not stuck and no significant state", async () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({ step: 2, fullState: fullState() });

    await expect(orchestrator.getAdviserHint()).resolves.toBeUndefined();
  });

  it("getAdviserHint() returns rendered plan when stuck", async () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({
      step: 3,
      fullState: fullState(),
      recentActions: Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } })),
      recentStates: Array.from({ length: 6 }, (_value, step) => ({ step, mapId: 38, y: 3, x: 3 })),
    });

    const hint = await orchestrator.getAdviserHint();

    expect(hint).toContain("recover");
    expect(hint?.length).toBeLessThanOrEqual(500);
  });

  it("getLedger() tracks events after updates", () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({ step: 4, fullState: fullState() });
    orchestrator.update({ step: 5, fullState: fullState({ flags: { ...fullState().flags, hasOaksParcel: true } }) });

    const snapshot = orchestrator.getLedger().snapshot();

    expect(snapshot.revision).toBe(2);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.map((event) => event.type)).toEqual([
      "supervisor.goal.updated",
      "supervisor.goal.updated",
    ]);
  });

  it("getLastPlan() returns the most recent plan", () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    const first = orchestrator.update({ step: 6, fullState: fullState() });
    const second = orchestrator.update({ step: 7, fullState: fullState({ party: { count: 0, members: [] } }) });

    expect(orchestrator.getLastPlan()).not.toBe(first);
    expect(orchestrator.getLastPlan()).toBe(second);
  });

  it("getAdviserHint returns cached KB entry for stuck situation", async () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({
      step: 10,
      fullState: fullState(),
      recentActions: Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } })),
      recentStates: Array.from({ length: 6 }, (_value, step) => ({ step, mapId: 38, y: 3, x: 3 })),
    });

    const kb = orchestrator.getKnowledgeBase();
    kb.record({
      situationKey: "map:38:badges:0:goal:recover-from-loop",
      advice: "Go downstairs and talk to Professor Oak to get your starter Pokemon.",
      mapId: 38,
      badges: 0,
    });

    const hint = await orchestrator.getAdviserHint();

    expect(hint?.startsWith("[Cached advice]")).toBe(true);
    expect(hint).toContain("Go downstairs");
    expect(hint?.length).toBeLessThanOrEqual(500);
  });

  it("getAdviserHint falls back to rendered plan when no KB hit and no LLM", async () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({
      step: 20,
      fullState: fullState(),
      recentActions: Array.from({ length: 5 }, () => ({ action: { type: "press", button: "A", frames: 5 } })),
      recentStates: Array.from({ length: 6 }, (_value, step) => ({ step, mapId: 38, y: 3, x: 3 })),
    });

    const hint = await orchestrator.getAdviserHint();

    expect(hint).toContain("recover");
    expect(hint?.length).toBeLessThanOrEqual(500);
  });

  it("getAdviserHint saves LLM result to KB", () => {
    const orchestrator = new SupervisorOrchestrator({
      evidenceDir: "runs",
      runId: "test-run",
      adviserModel: {} as import("ai").LanguageModel,
      adviserCooldownTurns: 1,
    });

    const kb = orchestrator.getKnowledgeBase();
    expect(kb.size).toBe(0);

    kb.record({
      situationKey: "map:38:badges:0:goal:get_starter",
      advice: "Head south to Route 1 and battle trainers.",
      mapId: 38,
      badges: 0,
    });

    expect(kb.size).toBe(1);
    expect(kb.entries[0]?.advice).toBe("Head south to Route 1 and battle trainers.");
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
