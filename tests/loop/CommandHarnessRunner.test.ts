import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandPolicy, PolicyInput } from "../../src/ai/Policy.js";
import type { Command, CommandResult, GameMode } from "../../src/control/CommandTypes.js";
import { executeCommand } from "../../src/executor/CommandExecutor.js";
import type { ExecutionContext } from "../../src/executor/CommandExecutor.js";
import { CommandHarnessRunner, type CommandRunnerGameState } from "../../src/loop/CommandHarnessRunner.js";
import type { DetectorStatus, ProgressDetector } from "../../src/pokemon/Detector.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";

vi.mock("../../src/executor/CommandExecutor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/executor/CommandExecutor.js")>();
  return { ...actual, executeCommand: vi.fn() };
});

const executeCommandMock = vi.mocked(executeCommand);

const navigateCommand: Command = { type: "navigate", x: 4, y: 5 };
const battleCommand: Command = { type: "battle", action: { kind: "fight", move: "Tackle" } };
const successResult: CommandResult = { status: "success", reason: "ok" };
const rejectedResult: CommandResult = { status: "rejected", reason: "guard", details: "bad command" };
const interruptedResult: CommandResult = { status: "interrupted", reason: "battle_started" };

describe("CommandHarnessRunner", () => {
  beforeEach(() => {
    executeCommandMock.mockReset();
    executeCommandMock.mockResolvedValue(successResult);
  });

  it("runs a simple overworld navigate command and advances one step", async () => {
    const policyInputs: PolicyInput[] = [];
    const runner = createRunner({
      policy: policyReturning(navigateCommand, policyInputs),
      states: [gameState(), gameState()],
      maxSteps: 2,
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(result.totalSteps).toBe(2);
    expect(result.llmCalls).toBe(2);
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
      maxSteps: 1,
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
      maxSteps: 1,
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
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
      maxSteps: 1,
      maxLlmCalls: 10,
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
      maxSteps: 2,
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(inputs.map((input) => input.mode)).toEqual(["overworld", "battle"]);
    expect(executeCommandMock.mock.calls[1]?.[1]).toMatchObject({ mode: "battle" });
  });

  it("stops when the LLM budget is exhausted", async () => {
    const runner = createRunner({
      policy: policyReturning(navigateCommand),
      states: [gameState(), gameState(), gameState()],
      maxSteps: 5,
      maxLlmCalls: 2,
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_budget");
    expect(result.llmCalls).toBe(2);
    expect(result.totalSteps).toBe(2);
  });

  it("stops when max steps are reached", async () => {
    const runner = createRunner({
      policy: policyReturning(navigateCommand),
      states: [gameState(), gameState(), gameState()],
      maxSteps: 2,
    });

    const result = await runner.run();

    expect(result.status).toBe("failed_timeout");
    expect(result.totalSteps).toBe(2);
  });

  it("keeps only the last ten command history entries", async () => {
    const runner = createRunner({
      policy: policyReturning(navigateCommand),
      states: Array.from({ length: 15 }, () => gameState()),
      maxSteps: 15,
      maxLlmCalls: 20,
    });

    const result = await runner.run();

    expect(result.commandHistory).toHaveLength(10);
    expect(result.commandHistory.map((entry) => entry.step)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("stops with completed when the detector reports completion", async () => {
    const detector = new FakeDetector(1);
    const runner = createRunner({
      detector,
      policy: policyReturning(navigateCommand),
      states: [gameState()],
      maxSteps: 5,
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
  maxSteps?: number;
  maxLlmCalls?: number;
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
    maxSteps: options.maxSteps ?? 1,
    maxLlmCalls: options.maxLlmCalls ?? 10,
    stepDelayMs: 0,
    sleep: async () => {},
    now: () => new Date("2026-05-25T00:00:00.000Z"),
    readGameState: async () => states.shift() ?? gameState(),
    updateMapMemory: async () => {},
    updateMapGraph: () => {},
  });
}

function policyReturning(command: Command, inputs: PolicyInput[] = []): CommandPolicy & { calls: number } {
  return {
    calls: 0,
    async chooseAction(input) {
      this.calls += 1;
      inputs.push(input);
      return { command, rationale: "test" };
    },
  };
}

function policySequence(commands: Command[], inputs: PolicyInput[] = []): CommandPolicy {
  let index = 0;
  return {
    async chooseAction(input) {
      inputs.push(input);
      return { command: commands[Math.min(index++, commands.length - 1)]!, rationale: "test" };
    },
  };
}

function gameState(options: { mode?: GameMode; textBoxId?: number } = {}): CommandRunnerGameState {
  const state = fullState(options.textBoxId ?? 0);
  return {
    fullState: state,
    mode: options.mode ?? "overworld",
    mapId: 1,
    playerY: 2,
    playerX: 3,
    facing: "down",
    mapWidth: 10,
    mapHeight: 9,
  };
}

function fullState(textBoxId = 0): FullGameState {
  return {
    player: { name: "RED", rivalName: "BLUE", money: 0, position: { mapId: 1, y: 2, x: 3, yBlock: 0, xBlock: 0 }, facing: { raw: 0, direction: "down" }, badges: { raw: 0, count: 0, obtained: [], names: [] }, playTime: "0:00" },
    map: { mapId: 1, mapName: "test", tilesetId: 0, width: 10, height: 9 },
    party: { count: 0, members: [] },
    bag: [],
    battle: { inBattle: false, type: "none" },
    dialog: { active: textBoxId !== 0, textBoxId, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: { hasPokedex: false, hasOaksParcel: false, deliveredOaksParcel: false, pokedexOwned: 0, pokedexSeen: 0, badges: { raw: 0, count: 0, obtained: [], names: [] } },
    menuText: { currentMenuItem: 0, textBoxId, letterPrintingDelayFlags: 0, screenText: textBoxId === 0 ? "" : "hello", screenTextKind: "overworld_text", namingScreenNameLength: 0, namingScreenSubmitName: 0, namingScreenType: 0 },
  };
}

class FakeController {
  readonly presses: Array<{ button: string; frames: number | undefined }> = [];

  async pressButton(button: string, frames?: number): Promise<void> {
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
