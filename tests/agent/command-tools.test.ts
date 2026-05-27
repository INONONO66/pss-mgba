import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommandAgentContext,
  CommandAgentGameState,
} from "../../src/agent/CommandAgentContext.js";
import { createCommandTools } from "../../src/agent/command-tools.js";
import type {
  CommandResult,
  GameMode,
} from "../../src/control/CommandTypes.js";
import type { InputGateIntentOptions } from "../../src/session/input-gate.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult } from "../../src/session/types.js";

const executeCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/executor/CommandExecutor.js", () => ({
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
}));

describe("command tools", () => {
  beforeEach(() => {
    executeCommandMock.mockReset();
    executeCommandMock.mockResolvedValue({
      status: "success",
      reason: "ok",
    } satisfies CommandResult);
  });

  it("delegates navigate with refreshed overworld state and map context", async () => {
    const context = createContext({
      states: [gameState({ x: 2, y: 3 }), gameState({ x: 4, y: 5 })],
    });
    const result = await executeTool(
      createCommandTools(context).pokemon_navigate,
      { x: 4, y: 5 }
    );

    expect(executeCommandMock).toHaveBeenCalledWith(
      { type: "navigate", x: 4, y: 5 },
      expect.objectContaining({
        inputGate: expect.objectContaining({ press: expect.any(Function) }),
        mode: "overworld",
        mapWidth: 20,
        mapHeight: 18,
      })
    );
    expect(context.updateMapMemory).toHaveBeenCalledTimes(2);
    expect(context.mapMemoryStore.onUpdate).toHaveBeenCalledTimes(2);
    expect(context.updateMapGraph).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      command: { type: "navigate", x: 4, y: 5 },
      before: { mode: "overworld", x: 2, y: 3 },
      after: { mode: "overworld", x: 4, y: 5 },
      mapSnippet: "micro:0:5:4:down",
    });
  });

  it("delegates interact with optional facing direction", async () => {
    const context = createContext();

    await executeTool(createCommandTools(context).pokemon_interact, {
      direction: "left",
    });

    expect(executeCommandMock).toHaveBeenCalledWith(
      { type: "interact", direction: "left" },
      expect.objectContaining({
        inputGate: expect.objectContaining({ press: expect.any(Function) }),
        mode: "overworld",
      })
    );
  });

  it("rejects wait in dialog mode instead of delegating", async () => {
    const context = createContext({
      states: [gameState({ mode: "dialog" }), gameState({ mode: "dialog" })],
    });
    const result = await executeTool(createCommandTools(context).pokemon_wait, {
      frames: 45,
    });

    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      command: { type: "wait", frames: 45 },
      result: { status: "rejected", reason: "dialog_wait_disabled" },
      before: { mode: "dialog" },
      after: { mode: "dialog" },
      hint: "Current mode is dialog; dialog advances automatically between turns. Use pokemon_dialog only for visible choices or naming prompts.",
    });
    expect(result).not.toHaveProperty("mapSnippet");
  });

  it("delegates dialog actions in dialog mode and surfaces mode-specific hints on rejection", async () => {
    executeCommandMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "not ready",
      details: "letters printing",
    });
    const context = createContext({
      states: [gameState({ mode: "dialog" }), gameState({ mode: "dialog" })],
    });
    const result = await executeTool(
      createCommandTools(context).pokemon_dialog,
      { action: { kind: "choose", index: 1 } }
    );

    expect(executeCommandMock).toHaveBeenCalledWith(
      { type: "dialog", action: { kind: "choose", index: 1 } },
      expect.objectContaining({
        inputGate: expect.objectContaining({ press: expect.any(Function) }),
        mode: "dialog",
      })
    );
    expect(result).toMatchObject({
      ok: false,
      command: { type: "dialog", action: { kind: "choose", index: 1 } },
      hint: "Current mode is dialog; dialog advances automatically between turns. Use pokemon_dialog only for visible choices or naming prompts.",
      result: {
        status: "rejected",
        reason: "not ready",
        details: "letters printing",
      },
    });
  });

  it("delegates battle actions in battle mode and includes battle snapshots", async () => {
    const battleStates = Array.from({ length: 50 }, () =>
      gameState({ mode: "battle", enemyHp: 5 })
    );
    const context = createContext({
      states: [gameState({ mode: "battle", enemyHp: 12 }), ...battleStates],
    });
    const result = await executeTool(
      createCommandTools(context).pokemon_battle,
      { action: { kind: "fight", move: "Scratch" } }
    );

    expect(executeCommandMock).toHaveBeenCalledWith(
      { type: "battle", action: { kind: "fight", move: "Scratch" } },
      expect.objectContaining({
        inputGate: expect.objectContaining({ press: expect.any(Function) }),
        mode: "battle",
      })
    );
    expect(result).toMatchObject({
      ok: true,
      command: { type: "battle", action: { kind: "fight", move: "Scratch" } },
      battle: {
        before: { inBattle: true, enemy: { name: "Pidgey", hp: 12 } },
        after: { inBattle: true, enemy: { name: "Pidgey", hp: 5 } },
      },
    });
    expect(result).not.toHaveProperty("mapSnippet");
  });

  it("advances post-battle dialog until overworld and returns battle_ended", async () => {
    const context = createContext({
      states: [
        gameState({ mode: "battle", enemyHp: 12 }),
        gameState({ mode: "battle", enemyHp: 0 }),
        gameState({ mode: "dialog" }),
        gameState({ mode: "overworld" }),
        gameState({ mode: "overworld" }),
      ],
    });
    executeCommandMock.mockResolvedValueOnce({
      status: "success",
      reason: "battle_ended",
    } satisfies CommandResult);

    const result = await executeTool(
      createCommandTools(context).pokemon_battle,
      { action: { kind: "fight", move: "Scratch" } }
    );

    expect(result).toMatchObject({
      ok: true,
      result: { status: "success", reason: "battle_ended" },
    });
    expect((result.after as Record<string, unknown>).mode).toBe("overworld");
  });

  it("stops post-battle dialog on choice_appeared for move learning", async () => {
    const choiceDialogStateReader = {
      readTextBoxId: vi.fn(async () => 0),
      readCurrentMenuItem: vi.fn(async () => 0),
      readScreenText: vi.fn(async () => "learn FLAMETHROWER?"),
      readTileAt: vi.fn(async () => 0),
      isDialogActive: vi.fn(async () => true),
      isWindowVisible: vi.fn(async () => true),
      isInBattle: vi.fn(async () => false),
      isChoiceActive: vi.fn(async () => true),
      isNamingScreenActive: vi.fn(async () => false),
    };
    const context = createContext({
      states: [
        gameState({ mode: "battle", enemyHp: 12 }),
        gameState({ mode: "battle", enemyHp: 0 }),
        gameState({ mode: "dialog" }),
        gameState({ mode: "dialog" }),
        gameState({ mode: "dialog" }),
      ],
    });
    (
      context.executionContext as unknown as Record<string, unknown>
    ).dialogStateReader = choiceDialogStateReader;

    executeCommandMock.mockResolvedValueOnce({
      status: "success",
      reason: "battle_ended",
    } satisfies CommandResult);

    const result = await executeTool(
      createCommandTools(context).pokemon_battle,
      { action: { kind: "fight", move: "Scratch" } }
    );

    expect(result).toMatchObject({
      ok: true,
      result: { status: "interrupted", reason: "choice_appeared" },
    });
  });

  it("returns battle_ended for successful run with narration", async () => {
    const context = createContext({
      states: [
        gameState({ mode: "battle", enemyHp: 12 }),
        gameState({ mode: "overworld" }),
        gameState({ mode: "overworld" }),
      ],
    });
    executeCommandMock.mockResolvedValueOnce({
      status: "success",
      reason: "battle_ended",
    } satisfies CommandResult);

    const result = await executeTool(
      createCommandTools(context).pokemon_battle,
      { action: { kind: "run" } }
    );

    expect(result).toMatchObject({
      ok: true,
      result: { status: "success", reason: "battle_ended" },
    });
  });
});

interface ExecutableTool {
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

async function executeTool(
  tool: unknown,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = await (tool as ExecutableTool).execute(input);
  return result as Record<string, unknown>;
}

function createContext(
  options: { states?: CommandAgentGameState[] } = {}
): CommandAgentContext {
  const states = [...(options.states ?? [gameState(), gameState()])];
  const executionContext = {
    mode: "overworld" as GameMode,
    fullState: states[0]?.fullState,
    mapWidth: 0,
    mapHeight: 0,
    controller: {
      pressButton: vi.fn(async () => undefined),
    },
    inputGate: {
      press: vi.fn(async (button, frames, intent = {}) =>
        inputResult(button, frames, intent, states[0]?.mode ?? "overworld")
      ),
    },
    dialogStateReader: {
      readTextBoxId: vi.fn(async () => 0),
      readCurrentMenuItem: vi.fn(async () => 0),
      readScreenText: vi.fn(async () => ""),
      readTileAt: vi.fn(async () => 0),
      isDialogActive: vi.fn(async () => false),
      isWindowVisible: vi.fn(async () => false),
      isInBattle: vi.fn(async () => false),
      isChoiceActive: vi.fn(async () => false),
      isNamingScreenActive: vi.fn(async () => false),
    },
  };

  return {
    executionContext,
    mapMemory: {
      renderMicro: vi.fn(
        (mapId: number, y: number, x: number, facing: string) =>
          `micro:${mapId}:${y}:${x}:${facing}`
      ),
    },
    mapMemoryStore: {
      onUpdate: vi.fn(),
    },
    readGameState: vi.fn(async () => states.shift() ?? gameState()),
    updateMapGraph: vi.fn(),
    updateMapMemory: vi.fn(async () => undefined),
  } as unknown as CommandAgentContext;
}

function inputResult(
  button: InputResult["intent"]["button"],
  frames: number,
  intent: InputGateIntentOptions,
  mode: GameMode
): InputResult {
  const state = createMiniState({
    battle: mode === "battle" ? 1 : 0,
    textBoxId: mode === "dialog" ? 1 : 0,
    letterDelay: 0,
    mapId: 0,
    y: 3,
    x: 2,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: mode === "dialog" ? 112 : 144,
    screenText: "",
  });
  return {
    after: state,
    before: state,
    executed: true,
    intent: {
      ...intent,
      button,
      frames,
      source: intent.source ?? "test",
    },
    transition: { after: state, before: state, kind: "none" },
  };
}

function gameState(
  overrides: { mode?: GameMode; x?: number; y?: number; enemyHp?: number } = {}
): CommandAgentGameState {
  const mode = overrides.mode ?? "overworld";
  return {
    facing: "down",
    fullState: fullState(mode, overrides.enemyHp),
    mapHeight: 18,
    mapId: 0,
    mapWidth: 20,
    mode,
    npcs: [],
    playerX: overrides.x ?? 2,
    playerY: overrides.y ?? 3,
    warps: [],
  } as CommandAgentGameState;
}

function fullState(
  mode: GameMode,
  enemyHp = 12
): CommandAgentGameState["fullState"] {
  return {
    battle: {
      enemy:
        mode === "battle"
          ? {
              species: "Pidgey",
              level: 3,
              hp: enemyHp,
              maxHp: 12,
              status: "OK",
              types: ["Normal", "Flying"],
              moves: [],
            }
          : undefined,
      inBattle: mode === "battle",
      type: mode === "battle" ? "wild" : "none",
    },
    party: {
      members: [
        {
          nickname: "CHARMANDER",
          species: "Charmander",
          level: 5,
          hp: 19,
          maxHp: 19,
          status: "OK",
          moves: [],
        },
      ],
    },
  } as unknown as CommandAgentGameState["fullState"];
}
