import { describe, expect, it, vi } from "vitest";
import type { FullGameState } from "../../src/game/PokemonTypes.js";
import { StuckEscalator, type StuckSnapshot, type StuckEscalatorConfig } from "../../src/supervisor/StuckEscalator.js";

describe("StuckEscalator", () => {
  it("does not escalate before threshold reached", () => {
    const escalator = createEscalator({ escalationThreshold: 5 });
    const snapshot = createSnapshot({ step: 10 });

    for (let i = 0; i < 4; i += 1) {
      escalator.reportStuck(snapshot);
    }

    expect(escalator.shouldEscalate(snapshot)).toBe(false);
    expect(escalator.getConsecutiveStuckTurns()).toBe(4);
  });

  it("escalates after threshold reached", () => {
    const escalator = createEscalator({ escalationThreshold: 5 });
    const snapshot = createSnapshot({ step: 10 });

    for (let i = 0; i < 5; i += 1) {
      escalator.reportStuck(snapshot);
    }

    expect(escalator.shouldEscalate(snapshot)).toBe(true);
  });

  it("resets consecutive count on reportProgress", () => {
    const escalator = createEscalator({ escalationThreshold: 3 });
    const snapshot = createSnapshot({ step: 10 });

    escalator.reportStuck(snapshot);
    escalator.reportStuck(snapshot);
    escalator.reportProgress();

    expect(escalator.getConsecutiveStuckTurns()).toBe(0);
    expect(escalator.shouldEscalate(snapshot)).toBe(false);
  });

  it("deduplicates by situation key", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/42\n" });
    const escalator = createEscalator({ escalationThreshold: 2, execGh });
    const snapshot = createSnapshot({ step: 10 });

    escalator.reportStuck(snapshot);
    escalator.reportStuck(snapshot);

    const first = await escalator.maybeEscalate(snapshot);
    expect(first).toBeDefined();
    expect(first?.issueNumber).toBe(42);

    // Same situation key should not escalate again
    escalator.reportStuck(snapshot);
    const second = await escalator.maybeEscalate(snapshot);
    expect(second).toBeUndefined();
    expect(execGh).toHaveBeenCalledTimes(1);
  });

  it("respects cooldown between escalations", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/1\n" });
    const escalator = createEscalator({ escalationThreshold: 2, execGh });

    // First escalation at step 10
    const snap1 = createSnapshot({ step: 10 });
    escalator.reportStuck(snap1);
    escalator.reportStuck(snap1);
    await escalator.maybeEscalate(snap1);

    // Different situation key but too close in step count
    escalator.reportProgress();
    const snap2 = createSnapshot({ step: 11, mapId: 99 });
    escalator.reportStuck(snap2);
    escalator.reportStuck(snap2);

    expect(escalator.shouldEscalate(snap2)).toBe(false);
  });

  it("allows escalation for different situation after cooldown", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/1\n" });
    const escalator = createEscalator({ escalationThreshold: 2, execGh });

    const snap1 = createSnapshot({ step: 10 });
    escalator.reportStuck(snap1);
    escalator.reportStuck(snap1);
    await escalator.maybeEscalate(snap1);

    escalator.reportProgress();
    const snap2 = createSnapshot({ step: 50, mapId: 99 });
    escalator.reportStuck(snap2);
    escalator.reportStuck(snap2);

    expect(escalator.shouldEscalate(snap2)).toBe(true);
  });

  it("calls gh issue create with correct args", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/7\n" });
    const escalator = createEscalator({ escalationThreshold: 1, execGh });
    const snapshot = createSnapshot({ step: 5 });

    escalator.reportStuck(snapshot);
    const result = await escalator.maybeEscalate(snapshot);

    expect(result).toBeDefined();
    expect(result?.issueUrl).toBe("https://github.com/test/repo/issues/7");
    expect(result?.issueNumber).toBe(7);

    expect(execGh).toHaveBeenCalledTimes(1);
    const callArgs = execGh.mock.calls[0];
    expect(callArgs[0]).toBe("gh");
    expect(callArgs[1]).toContain("issue");
    expect(callArgs[1]).toContain("create");
    expect(callArgs[1]).toContain("--label");
    expect(callArgs[1]).toContain("stuck-escalation");
  });

  it("issue title contains map name, badges, and goal", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/1\n" });
    const escalator = createEscalator({ escalationThreshold: 1, execGh });
    const snapshot = createSnapshot({ step: 5 });

    escalator.reportStuck(snapshot);
    await escalator.maybeEscalate(snapshot);

    const titleArgIdx = execGh.mock.calls[0][1].indexOf("--title") + 1;
    const title = execGh.mock.calls[0][1][titleArgIdx] as string;

    expect(title).toContain("[Stuck]");
    expect(title).toContain("Reds House 2f");
    expect(title).toContain("0 badges");
    expect(title).toContain("Explore the area");
  });

  it("issue body contains game state details", async () => {
    const execGh = vi.fn().mockResolvedValue({ stdout: "https://github.com/test/repo/issues/1\n" });
    const escalator = createEscalator({ escalationThreshold: 1, execGh });
    const snapshot = createSnapshot({ step: 5 });

    escalator.reportStuck(snapshot);
    await escalator.maybeEscalate(snapshot);

    const bodyArgIdx = execGh.mock.calls[0][1].indexOf("--body") + 1;
    const body = execGh.mock.calls[0][1][bodyArgIdx] as string;

    expect(body).toContain("## Stuck Escalation Report");
    expect(body).toContain("## Game State");
    expect(body).toContain("Reds House 2f");
    expect(body).toContain("Charmander");
    expect(body).toContain("## Stuck Assessment");
    expect(body).toContain("## Active Goal");
    expect(body).toContain("## Suggested Investigation");
    expect(body).toContain("test-run");
  });

  it("handles gh cli failure gracefully", async () => {
    const execGh = vi.fn().mockRejectedValue(new Error("gh not found"));
    const escalator = createEscalator({ escalationThreshold: 1, execGh });
    const snapshot = createSnapshot({ step: 5 });

    escalator.reportStuck(snapshot);
    const result = await escalator.maybeEscalate(snapshot);

    expect(result).toBeUndefined();
    // Should not mark as escalated so it can retry
    expect(escalator.getEscalatedKeys().size).toBe(0);
  });

  it("returns undefined when not ready to escalate", async () => {
    const execGh = vi.fn();
    const escalator = createEscalator({ escalationThreshold: 10, execGh });
    const snapshot = createSnapshot({ step: 5 });

    escalator.reportStuck(snapshot);
    const result = await escalator.maybeEscalate(snapshot);

    expect(result).toBeUndefined();
    expect(execGh).not.toHaveBeenCalled();
  });
});

function createEscalator(overrides: Partial<StuckEscalatorConfig> & { execGh?: StuckEscalatorConfig["execGh"] } = {}): StuckEscalator {
  return new StuckEscalator({
    evidenceDir: "runs",
    runId: "test-run",
    ...overrides,
  });
}

function createSnapshot(overrides: { step?: number; mapId?: number } = {}): StuckSnapshot {
  const mapId = overrides.mapId ?? 38;
  return {
    step: overrides.step ?? 1,
    assessment: {
      state: "stuck",
      reasons: ["Same action repeated 5 times while progress context stayed stable for 6 observations."],
      repeatedActionCount: 5,
      stableLocationCount: 6,
    },
    activeGoal: {
      id: "explore-1",
      kind: "explore",
      title: "Explore the area",
      status: "active",
      priority: 1,
      why: "Need to find the next objective",
      successCriteria: ["Find a new location"],
    },
    fullState: fullState(mapId),
    adviserHintGiven: true,
    interventionAttempted: true,
  };
}

function fullState(mapId = 38): FullGameState {
  return {
    player: {
      name: "RED",
      rivalName: "BLUE",
      money: 3000,
      position: { mapId, y: 3, x: 3, yBlock: 1, xBlock: 1 },
      facing: { raw: 8, direction: "left" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "1:38:18.22",
    },
    map: { mapId, mapName: "Reds House 2f", tilesetId: 4, width: 4, height: 4 },
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
  };
}
