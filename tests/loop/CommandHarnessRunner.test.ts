import { describe, expect, it, vi, beforeEach } from "vitest";
import { CommandHarnessRunner, type CommandRunnerGameState, type CommandRunnerOptions } from "../../src/loop/CommandHarnessRunner.js";
import type { CommandPolicy, PolicyInput, CommandPolicyDecision } from "../../src/ai/Policy.js";
import type { Command, CommandResult } from "../../src/control/CommandTypes.js";
import type { ExecutionContext } from "../../src/executor/CommandExecutor.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";
import type { DetectorStatus, ProgressDetector } from "../../src/pokemon/Detector.js";

vi.mock("../../src/executor/CommandExecutor.js", () => ({
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
}));

const executeCommandMock = vi.fn();

const navigateCommand: Command = { type: "navigate", x: 5, y: 3 };
const battleCommand: Command = { type: "battle", action: { kind: "fight", move: "Scratch" } };
const successResult: CommandResult = { status: "success", reason: "arrived" };
const rejectedResult: CommandResult = { status: "rejected", reason: "guard", details: "bad command" };
const interruptedResult: CommandResult = { status: "interrupted", reason: "battle_started" };

describe("CommandHarnessRunner", () => {
  beforeEach(() => {
    executeCommandMock.mockReset();
    executeCommandMock.mockResolvedValue(successResult);
  });

  it("runs a simple overworld navigate command and completes", async () => {
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      policy: policyReturning(navigateCommand, policyInputs),
      states: [gameState(), gameState()],
      detector: new FakeDetector(2),
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.totalSteps).toBe(2);
    expect(executeCommandMock).toHaveBeenCalledWith(navigateCommand, expect.objectContaining({ mode: "overworld" }));
    expect(policyInputs[0]).toMatchObject({ mode: "overworld", step: 0 });
  });

  it("auto-advances dialog without consuming an LLM call or step", async () => {
    const controller = new FakeController();
    const policy = policyReturning(navigateCommand);
    const runner = createRunner({
      controller,
      policy,
      states: [gameState({ mode: "dialog", textBoxId: 1 }), gameState({ mode: "overworld", textBoxId: 0 }), gameState()],
      detector: new FakeDetector(1),
    });

    const result = await runner.run();

    expect(controller.presses).toEqual([{ button: "A", frames: 8 }]);
    expect(result.llmCalls).toBe(1);
    expect(result.totalSteps).toBe(1);
    expect(policy.calls).toBe(1);
  });

  it("retries rejected commands without consuming a step", async () => {
    executeCommandMock.mockResolvedValueOnce(rejectedResult).mockResolvedValueOnce(successResult);
    const decisions: Command[] = [{ type: "navigate", x: -1, y: 1 }, navigateCommand];
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      policy: policySequence(decisions, policyInputs),
      states: [gameState()],
      detector: new FakeDetector(1),
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.totalSteps).toBe(1);
    expect(result.llmCalls).toBe(2);
    expect(policyInputs[1]?.lastResult).toEqual(rejectedResult);
    expect(result.commandHistory).toHaveLength(2);
    expect(result.commandHistory.map((entry) => entry.step)).toEqual([0, 0]);
  });

  it("fails after guard retry exhaustion", async () => {
    executeCommandMock.mockResolvedValue(rejectedResult);
    const runner = createRunner({
      policy: policyReturning(navigateCommand),
      states: [gameState()],
    });

    await expect(runner.run()).rejects.toMatchObject({ code: "ACTION_REJECTED" });
    expect(executeCommandMock).toHaveBeenCalledTimes(4);
  });

  it("passes battle mode after a navigation interrupt when state switches to battle", async () => {
    executeCommandMock.mockResolvedValueOnce(interruptedResult).mockResolvedValueOnce(successResult);
    const inputs: PolicyInput[] = [];
    const runner = createRunner({
      policy: policySequence([navigateCommand, battleCommand], inputs),
      states: [gameState(), gameState({ mode: "battle" })],
      detector: new FakeDetector(2),
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(inputs.map((input) => input.mode)).toEqual(["overworld", "battle"]);
    expect(executeCommandMock.mock.calls[1]?.[1]).toMatchObject({ mode: "battle" });
  });

  it("keeps only the last ten command history entries", async () => {
    const runner = createRunner({
      policy: policyReturning(navigateCommand),
      states: Array.from({ length: 15 }, () => gameState()),
      detector: new FakeDetector(15),
    });

    const result = await runner.run();

    expect(result.commandHistory).toHaveLength(10);
  });

  it("stops with completed when the detector reports completion", async () => {
    const detector = new FakeDetector(1);
    const runner = createRunner({
      detector,
      policy: policyReturning(navigateCommand),
      states: [gameState()],
    });

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(result.totalSteps).toBe(1);
    expect(result.detector.status).toBe("completed");
  });
});

function createRunner(options: {
  policy?: CommandPolicy & { calls?: number };
  states?: CommandRunnerGameState[];
  controller?: FakeController;
  detector?: FakeDetector;
} = {}): CommandHarnessRunner {
  const states = [...(options.states ?? [gameState()])];
  const controller = options.controller ?? new FakeController();
  const dialogReader = new FakeDialogReader();
  const executionContext: ExecutionContext = {
    mode: states[0]?.mode ?? "overworld",
    fullState: states[0]?.fullState ?? fullState(),
    mapWidth: 10,
    mapHeight: 9,
    controller,
    navigateWorldReader: {} as ExecutionContext["navigateWorldReader"],
    navigateMapSource: {} as ExecutionContext["navigateMapSource"],
    interactStateReader: {} as ExecutionContext["interactStateReader"],
    dialogStateReader: dialogReader,
  };

  return new CommandHarnessRunner({
    policy: options.policy ?? policyReturning(navigateCommand),
    executionContext,
    mapMemory: {
      renderFullMap: () => "full map",
      renderMicro: () => "Position: (3,2), facing down\nAdjacent: Up:open, Down:wall, Left:unknown, Right:npc",
    } as never,
    mapGraph: { renderForLLM: () => "graph" } as never,
    detector: options.detector ?? new FakeDetector(),
    stepDelayMs: 0,
    sleep: async () => {},
    now: () => new Date("2026-05-25T00:00:00.000Z"),
    readGameState: async () => states.shift() ?? gameState(),
    updateMapMemory: async () => {},
    updateMapGraph: () => {},
  });
}

function fullState(): FullGameState {
  return {
    player: { name: "RED", rivalName: "BLUE", money: 3000, position: { mapId: 0, y: 3, x: 5, yBlock: 0, xBlock: 0 }, facing: { raw: 0, direction: "down" }, badges: { raw: 0, count: 0, obtained: [], names: [] }, playTime: "0:00:00.00" },
    map: { mapId: 0, mapName: "Pallet Town", tilesetId: 0, width: 10, height: 9 },
    party: { count: 1, members: [{ slot: 0, speciesId: 0xb0, species: "Charmander", nickname: "CHARMANDER", level: 5, hp: 19, maxHp: 19, status: "OK", types: ["Fire", "Fire"], moves: [{ id: 10, name: "Scratch", pp: 35, ppUp: 0 }], stats: { attack: 12, defense: 11, speed: 13, special: 12 }, experience: 135 }] },
    bag: [],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 0, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: { hasPokedex: false, hasOaksParcel: false, deliveredOaksParcel: false, pokedexOwned: 0, pokedexSeen: 0, badges: { raw: 0, count: 0, obtained: [], names: [] } },
    menuText: { currentMenuItem: 0, textBoxId: 0, letterPrintingDelayFlags: 0, screenText: "", screenTextKind: "none", namingScreenNameLength: 0, namingScreenSubmitName: 0, namingScreenType: 0 },
  };
}

function gameState(overrides: Partial<CommandRunnerGameState> & { textBoxId?: number } = {}): CommandRunnerGameState {
  const fs = fullState();
  if (overrides.textBoxId !== undefined) {
    (fs.dialog as { textBoxId: number }).textBoxId = overrides.textBoxId;
  }
  return {
    fullState: fs,
    mode: overrides.mode ?? "overworld",
    mapId: overrides.mapId ?? 0,
    playerY: overrides.playerY ?? 3,
    playerX: overrides.playerX ?? 5,
    facing: overrides.facing ?? "down",
    mapWidth: overrides.mapWidth ?? 20,
    mapHeight: overrides.mapHeight ?? 18,
  };
}

function policyReturning(command: Command, inputs?: PolicyInput[]): CommandPolicy & { calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    async chooseAction(input: PolicyInput): Promise<CommandPolicyDecision> {
      calls += 1;
      inputs?.push(input);
      return { command, rationale: "test" };
    },
  };
}

function policySequence(commands: Command[], inputs?: PolicyInput[]): CommandPolicy & { calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    async chooseAction(input: PolicyInput): Promise<CommandPolicyDecision> {
      const command = commands[calls] ?? commands[commands.length - 1];
      calls += 1;
      inputs?.push(input);
      return { command, rationale: "test" };
    },
  };
}

class FakeController {
  presses: Array<{ button: string; frames: number }> = [];
  async pressButton(button: string, frames = 5): Promise<void> {
    this.presses.push({ button, frames });
  }
}

class FakeDialogReader {
  async readTextBoxId(): Promise<number> { return 0; }
  async readCurrentMenuItem(): Promise<number> { return 0; }
  async readScreenText(): Promise<string> { return ""; }
  async isDialogActive(): Promise<boolean> { return false; }
  async isChoiceActive(): Promise<boolean> { return false; }
  async isNamingScreenActive(): Promise<boolean> { return false; }
}

class FakeDetector implements ProgressDetector<Record<string, unknown>, DetectorStatus> {
  private updates = 0;
  private completed = false;

  constructor(private readonly completeAfterUpdates = Number.POSITIVE_INFINITY) {}

  update(): DetectorStatus {
    this.updates += 1;
    if (this.updates >= this.completeAfterUpdates) {
      this.completed = true;
    }
    return this.getStatus();
  }

  getStatus(): DetectorStatus {
    return { status: this.completed ? "completed" : "running", checkpoints: { completed: this.completed } };
  }
}
