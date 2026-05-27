import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ExecutionContext,
  executeCommand,
} from "../../src/executor/CommandExecutor.js";
import type {
  FullGameState,
  MoveSlot,
  PartyPokemon,
} from "../../src/game/PokemonTypes.js";
import type { MgbaButton } from "../../src/mgba/MgbaTypes.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult } from "../../src/session/types.js";

vi.mock("../../src/executor/NavigateExecutor.js", () => ({
  executeNavigate: vi.fn(async () => ({
    status: "success",
    reason: "navigated",
  })),
}));

vi.mock("../../src/executor/InteractExecutor.js", () => ({
  executeInteract: vi.fn(async () => ({
    status: "success",
    reason: "interacted",
  })),
}));

vi.mock("../../src/executor/DialogExecutor.js", () => ({
  DialogExecutor: class {
    execute = vi.fn(async () => ({ status: "success", reason: "dialog_done" }));
  },
}));

vi.mock("../../src/executor/BattleExecutor.js", () => ({
  executeBattle: vi.fn(async () => ({
    status: "success",
    reason: "battle_done",
  })),
}));

vi.mock("../../src/executor/Guards.js", () => ({
  validateCommand: vi.fn(() => ({ valid: true })),
}));

import { executeBattle } from "../../src/executor/BattleExecutor.js";
import { validateCommand } from "../../src/executor/Guards.js";
import { executeInteract } from "../../src/executor/InteractExecutor.js";
import { executeNavigate } from "../../src/executor/NavigateExecutor.js";

function createFullGameState(): FullGameState {
  const moveSlots: MoveSlot[] = [
    { id: 1, name: "Tackle", pp: 35, ppUp: 0, maxPp: 35 },
  ];
  const members: PartyPokemon[] = [
    {
      slot: 0,
      speciesId: 1,
      species: "Bulbasaur",
      nickname: "Bulbasaur",
      level: 5,
      hp: 20,
      maxHp: 20,
      status: "OK",
      types: ["Grass", "Poison"],
      moves: moveSlots,
      stats: { attack: 10, defense: 10, speed: 10, special: 10 },
      experience: 0,
    },
  ];

  return {
    player: {
      name: "Red",
      rivalName: "Blue",
      money: 3000,
      position: { mapId: 1, y: 5, x: 5, yBlock: 0, xBlock: 0 },
      facing: { raw: 0, direction: "down" },
      badges: { raw: 0, count: 0, obtained: [], names: [] },
      playTime: "00:00",
    },
    map: { mapId: 1, mapName: "Test Map", tilesetId: 0, width: 10, height: 10 },
    party: { count: members.length, members },
    bag: [{ id: 1, name: "Potion", quantity: 3 }],
    battle: { inBattle: false, type: "wild" },
    dialog: {
      active: false,
      textBoxId: 0,
      letterPrintingDelayFlags: 0,
      joyIgnore: 0,
    },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [], names: [] },
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

function createController() {
  const pressed: Array<{ button: MgbaButton; frames?: number }> = [];
  return {
    pressed,
    pressButton: vi.fn(async (button: MgbaButton, frames?: number) => {
      pressed.push({ button, frames });
      await Promise.resolve();
    }),
  };
}

function createInputResult(button: MgbaButton, frames = 5): InputResult {
  const state = createMiniState({
    battle: 0,
    textBoxId: 0,
    letterDelay: 0,
    mapId: 1,
    y: 5,
    x: 5,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: 144,
    screenText: "",
  });
  return {
    before: state,
    after: state,
    executed: true,
    intent: { button, frames, source: "agent" },
    transition: { kind: "none", before: state, after: state },
  };
}

function createContext(
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    mode: "overworld",
    fullState: createFullGameState(),
    mapWidth: 20,
    mapHeight: 20,
    controller: createController(),
    inputGate: {
      press: vi.fn(async (button, frames) => createInputResult(button, frames)),
    },
    navigateWorldReader: {
      readPosition: vi.fn(async () => ({ mapId: 1, y: 5, x: 5 })),
      readWalkCounter: vi.fn(async () => 0),
      isInBattle: vi.fn(async () => false),
      isDialogActive: vi.fn(async () => false),
    },
    navigateMapSource: {
      walkabilityGrid: vi.fn(() => undefined),
    },
    interactStateReader: {
      readFacingDirection: vi.fn(async () => "down"),
      isDialogActive: vi.fn(async () => false),
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
    sleep: vi.fn(async () => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(validateCommand).mockReturnValue({ valid: true });
});

describe("CommandExecutor", () => {
  it("navigate in overworld routes to executeNavigate", async () => {
    const ctx = createContext({ mode: "overworld" });
    const result = await executeCommand({ type: "navigate", x: 3, y: 4 }, ctx);

    expect(executeNavigate).toHaveBeenCalledWith(
      { type: "navigate", x: 3, y: 4 },
      expect.objectContaining({ pressButton: expect.any(Function) }),
      ctx.navigateWorldReader,
      ctx.navigateMapSource
    );
    expect(result.status).toBe("success");
  });

  it("battle in battle mode routes to executeBattle", async () => {
    const ctx = createContext({ mode: "battle" });
    const result = await executeCommand(
      { type: "battle", action: { kind: "run" } },
      ctx
    );

    expect(executeBattle).toHaveBeenCalledWith(
      { type: "battle", action: { kind: "run" } },
      expect.objectContaining({ pressButton: expect.any(Function) }),
      ctx.fullState,
      ctx.dialogStateReader
    );
    expect(result.status).toBe("success");
  });

  it("dialog in dialog mode routes to DialogExecutor", async () => {
    const ctx = createContext({ mode: "dialog" });
    const result = await executeCommand(
      { type: "dialog", action: { kind: "advance" } },
      ctx
    );

    expect(result.status).toBe("success");
    expect(result.reason).toBe("dialog_done");
  });

  it("navigate in battle mode returns mode_mismatch rejection", async () => {
    const ctx = createContext({ mode: "battle" });
    const result = await executeCommand({ type: "navigate", x: 1, y: 1 }, ctx);

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("mode_mismatch");
    expect(result.details).toBe("Cannot use navigate in battle mode");
  });

  it("battle in overworld returns mode_mismatch rejection", async () => {
    const ctx = createContext({ mode: "overworld" });
    const result = await executeCommand(
      { type: "battle", action: { kind: "run" } },
      ctx
    );

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("mode_mismatch");
    expect(result.details).toBe("Cannot use battle in overworld mode");
  });

  it("guard rejection returns the guard result", async () => {
    vi.mocked(validateCommand).mockReturnValue({
      valid: false,
      result: { status: "rejected", reason: "no_pp", details: "Move has 0 PP" },
    });

    const ctx = createContext({ mode: "battle" });
    const result = await executeCommand(
      { type: "battle", action: { kind: "fight", move: "Tackle" } },
      ctx
    );

    expect(result.status).toBe("rejected");
    expect(result.reason).toBe("no_pp");
    expect(result.details).toBe("Move has 0 PP");
  });

  it("wait sleeps correct duration and returns success", async () => {
    const sleep = vi.fn(async () => Promise.resolve());
    const ctx = createContext({ mode: "overworld", sleep });
    const result = await executeCommand({ type: "wait", frames: 60 }, ctx);

    expect(sleep).toHaveBeenCalledWith(60 * (1000 / 60));
    expect(result.status).toBe("success");
  });

  it("raw executes button sequence and returns success", async () => {
    const ctx = createContext({ mode: "overworld" });
    const result = await executeCommand(
      {
        type: "raw",
        inputs: [
          { button: "A", frames: 5 },
          { button: "B", frames: 3 },
        ],
        reason: "test",
      },
      ctx
    );

    expect(ctx.inputGate.press).toHaveBeenCalledWith(
      "A",
      5,
      expect.objectContaining({ reason: "command:raw", source: "agent" })
    );
    expect(ctx.inputGate.press).toHaveBeenCalledWith(
      "B",
      3,
      expect.objectContaining({ reason: "command:raw", source: "agent" })
    );
    expect(ctx.controller.pressButton).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("interact in overworld routes to executeInteract", async () => {
    const ctx = createContext({ mode: "overworld" });
    const result = await executeCommand(
      { type: "interact", direction: "up" },
      ctx
    );

    expect(executeInteract).toHaveBeenCalledWith(
      { type: "interact", direction: "up" },
      expect.objectContaining({ pressButton: expect.any(Function) }),
      ctx.interactStateReader
    );
    expect(result.status).toBe("success");
  });
});
