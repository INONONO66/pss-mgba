import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FullGameState } from "../../src/game/PokemonTypes.js";
import { SupervisorOrchestrator } from "../../src/supervisor/index.js";

const TMP_BASE = "/var/folders/70/44j59lmn1x95z003s9fg4qlm0000gn/T/opencode";

function uniqueDir(prefix: string): string {
  return path.join(TMP_BASE, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

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

  it("detects stuck from cycling navigate commands and returns adviser hint", async () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });
    const cycle = [
      { command: { type: "navigate", x: 6, y: 2 }, result: { status: "success", reason: "arrived" }, step: 1 },
      { command: { type: "navigate", x: 7, y: 2 }, result: { status: "success", reason: "arrived" }, step: 2 },
      { command: { type: "navigate", x: 8, y: 2 }, result: { status: "success", reason: "arrived" }, step: 3 },
    ];
    const recentActions = [...cycle, ...cycle, ...cycle];
    const recentStates = Array.from({ length: 10 }, (_v, i) => ({
      step: i, mapId: 40, y: 2, x: 6 + (i % 3),
    }));

    orchestrator.update({
      step: 30,
      fullState: fullState({
        map: { ...fullState().map, mapId: 40, mapName: "Oaks Lab" },
        player: { ...fullState().player, position: { ...fullState().player.position, mapId: 40, y: 2, x: 6 } },
      }),
      recentActions,
      recentStates,
    });

    const plan = orchestrator.getLastPlan();
    expect(plan?.assessment.state).toBe("stuck");

    const hint = await orchestrator.getAdviserHint();
    expect(hint).toBeDefined();
    expect(hint?.length).toBeGreaterThan(0);
    expect(hint?.length).toBeLessThanOrEqual(500);
  });

  it("detects stuck via noProgress when lastProgressStep is far behind", () => {
    const orchestrator = new SupervisorOrchestrator({ evidenceDir: "runs", runId: "test-run" });

    orchestrator.update({
      step: 124,
      fullState: fullState(),
      detectorStatus: { lastProgressStep: 6 },
      recentActions: [],
      recentStates: [],
    });

    const plan = orchestrator.getLastPlan();
    expect(plan?.assessment.state).toBe("stuck");
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

  it("auto-records to persistent memory when stuck resolves", async () => {
    const dir = uniqueDir("orch-pm");
    await mkdir(dir, { recursive: true });
    const pmPath = path.join(dir, "persistent-memory.json");

    const orchestrator = new SupervisorOrchestrator({
      evidenceDir: "runs",
      runId: "test-run",
      persistentMemoryPath: pmPath,
    });
    await orchestrator.init();

    const stuckActions = Array.from({ length: 5 }, () => ({
      action: { type: "press", button: "A", frames: 5 },
    }));
    const stuckStates = Array.from({ length: 6 }, (_v, i) => ({
      step: i, mapId: 38, y: 3, x: 3,
    }));

    orchestrator.update({
      step: 10,
      fullState: fullState(),
      recentActions: stuckActions,
      recentStates: stuckStates,
    });

    const planAfterStuck = orchestrator.getLastPlan();
    expect(planAfterStuck?.assessment.state).toBe("stuck");

    orchestrator.update({
      step: 18,
      fullState: fullState({
        map: { ...fullState().map, mapId: 1, mapName: "Pallet Town" },
        player: { ...fullState().player, position: { ...fullState().player.position, mapId: 1, y: 5, x: 5 } },
      }),
      recentActions: [],
      recentStates: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const pm = orchestrator.getPersistentMemory();
    expect(pm.size).toBe(1);

    const entry = pm.entries[0];
    expect(entry?.kind).toBe("mistake_resolved");
    expect(entry?.mapId).toBe(38);
    expect(entry?.mapName).toBe("Reds House 2f");
    expect(entry?.situation).toContain("loop");
    expect(entry?.resolution).toContain("Resolved after 8 turns");
    expect(entry?.resolution).toContain("Pallet Town");
    expect(entry?.tags).toContain("map:38");
  });

  it("does not record to persistent memory when not previously stuck", async () => {
    const dir = uniqueDir("orch-pm-no-stuck");
    await mkdir(dir, { recursive: true });
    const pmPath = path.join(dir, "persistent-memory.json");

    const orchestrator = new SupervisorOrchestrator({
      evidenceDir: "runs",
      runId: "test-run",
      persistentMemoryPath: pmPath,
    });
    await orchestrator.init();

    orchestrator.update({ step: 1, fullState: fullState() });
    orchestrator.update({ step: 2, fullState: fullState() });

    const pm = orchestrator.getPersistentMemory();
    expect(pm.size).toBe(0);
  });

  it("queryRelevantMemories returns matching entries", async () => {
    const dir = uniqueDir("orch-pm-query");
    await mkdir(dir, { recursive: true });
    const pmPath = path.join(dir, "persistent-memory.json");

    const orchestrator = new SupervisorOrchestrator({
      evidenceDir: "runs",
      runId: "test-run",
      persistentMemoryPath: pmPath,
    });
    await orchestrator.init();

    const pm = orchestrator.getPersistentMemory();
    await pm.record({
      runId: "old-run",
      kind: "mistake_resolved",
      mapId: 38,
      mapName: "Reds House 2f",
      badges: 0,
      situation: "Past mistake",
      resolution: "Past resolution",
      tags: ["map:38"],
    });

    const results = orchestrator.queryRelevantMemories(38, 0);
    expect(results.length).toBe(1);
    expect(results[0]?.situation).toBe("Past mistake");
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
