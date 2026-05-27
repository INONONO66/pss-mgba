import { describe, expect, it, vi } from "vitest";
import type { Command } from "../../src/control/CommandTypes.js";
import { executeBattle } from "../../src/executor/BattleExecutor.js";
import {
  type ExecutionContext,
  executeCommand,
} from "../../src/executor/CommandExecutor.js";
import { createMiniState } from "../../src/session/mini-state-reader.js";
import type { InputResult, MiniState } from "../../src/session/types.js";

vi.mock("../../src/executor/BattleExecutor.js", () => ({
  executeBattle: vi.fn(),
}));

function mini(): MiniState {
  return createMiniState({
    battle: 0,
    textBoxId: 0,
    letterDelay: 0,
    mapId: 1,
    y: 5,
    x: 4,
    partyCount: 1,
    walkCounter: 0,
    joyIgnore: 0,
    namingScreenType: 0,
    windowY: 144,
    screenText: "",
  });
}

function inputResult(
  button: InputResult["intent"]["button"],
  frames: number,
  executed = true,
  reason = "joy-ignore"
): InputResult {
  const state = mini();
  return {
    before: state,
    after: state,
    executed,
    reason: executed ? undefined : reason,
    intent: { button, frames, source: "agent" },
    transition: { kind: "none", before: state, after: state },
  };
}

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    mode: "overworld",
    fullState: {
      battle: { inBattle: false },
      player: { position: { mapId: 1 }, badges: { count: 0 } },
      party: { members: [] },
    } as unknown as ExecutionContext["fullState"],
    mapWidth: 20,
    mapHeight: 18,
    controller: { pressButton: vi.fn(async () => undefined) },
    inputGate: {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    },
    navigateWorldReader: {} as ExecutionContext["navigateWorldReader"],
    navigateMapSource: {} as ExecutionContext["navigateMapSource"],
    interactStateReader: {
      readFacingDirection: vi.fn(async () => "down"),
      isDialogActive: vi.fn(async () => false),
    },
    dialogStateReader: {} as ExecutionContext["dialogStateReader"],
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("CommandRouter session input delegation", () => {
  it("sends raw inputs through InputGate when available", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    };
    const fallback = { pressButton: vi.fn(async () => undefined) };
    const command = {
      type: "raw",
      reason: "test",
      inputs: [{ button: "A", frames: 5 }],
    } satisfies Command;

    const result = await executeCommand(
      command,
      context({ controller: fallback, inputGate })
    );

    expect(result).toMatchObject({
      status: "success",
      reason: "raw_inputs_sent",
    });
    expect(inputGate.press).toHaveBeenCalledWith(
      "A",
      5,
      expect.objectContaining({ reason: "command:raw", source: "agent" })
    );
    expect(fallback.pressButton).not.toHaveBeenCalled();
  });

  it("turns rejected session input into a rejected command result", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) =>
        inputResult(button, frames, false)
      ),
    };
    const command = {
      type: "raw",
      reason: "test",
      inputs: [{ button: "A", frames: 5 }],
    } satisfies Command;

    const result = await executeCommand(command, context({ inputGate }));

    expect(result).toMatchObject({ status: "rejected", reason: "joy-ignore" });
  });

  it("aborts raw sequences on the first rejected session input", async () => {
    const inputGate = {
      press: vi
        .fn()
        .mockResolvedValueOnce(inputResult("A", 5, false))
        .mockResolvedValueOnce(inputResult("B", 5)),
    };
    const command = {
      type: "raw",
      reason: "test",
      inputs: [
        { button: "A", frames: 5 },
        { button: "B", frames: 5 },
      ],
    } satisfies Command;

    const result = await executeCommand(command, context({ inputGate }));

    expect(result).toMatchObject({ status: "rejected", reason: "joy-ignore" });
    expect(inputGate.press).toHaveBeenCalledTimes(1);
  });

  it("does not override InputGate dialog defaults for raw A presses", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    };
    const command = {
      type: "raw",
      reason: "dialog advance fallback",
      inputs: [{ button: "A", frames: 5 }],
    } satisfies Command;

    await executeCommand(command, context({ inputGate }));

    expect(inputGate.press).toHaveBeenCalledWith(
      "A",
      5,
      expect.not.objectContaining({ allowDialog: false })
    );
  });

  it("routes interact button intents through InputGate", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    };
    const result = await executeCommand(
      { type: "interact" },
      context({ inputGate })
    );

    expect(result.status).toBe("success");
    expect(inputGate.press).toHaveBeenCalledWith(
      "A",
      8,
      expect.objectContaining({ allowDialog: true, reason: "command:interact" })
    );
  });

  it("does not allow dialog for interact direction-turn inputs", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) =>
        inputResult(button, frames, false, "text-window")
      ),
    };

    const result = await executeCommand(
      { type: "interact", direction: "left" },
      context({ inputGate })
    );

    expect(result).toMatchObject({
      status: "rejected",
      reason: "text-window",
    });
    expect(inputGate.press).toHaveBeenCalledTimes(1);
    expect(inputGate.press).toHaveBeenCalledWith(
      "Left",
      8,
      expect.not.objectContaining({ allowDialog: true })
    );
  });

  it("allows battle menu input while the battle text window is visible", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    };
    vi.mocked(executeBattle).mockImplementationOnce(
      async (_command, controller) => {
        await controller.pressButton("Down", 5);
        return { status: "success", reason: "move_selected" };
      }
    );

    const result = await executeCommand(
      { type: "battle", action: { kind: "fight", move: "TACKLE" } },
      context({
        inputGate,
        mode: "battle",
        fullState: {
          battle: { inBattle: true, type: "wild" },
          player: { position: { mapId: 1 }, badges: { count: 0 } },
          party: {
            members: [
              {
                hp: 10,
                moves: [{ name: "TACKLE", pp: 35, maxPp: 35 }],
                nickname: "Bulby",
              },
            ],
          },
          bag: [],
        } as unknown as ExecutionContext["fullState"],
      })
    );

    expect(result.status).toBe("success");
    expect(inputGate.press).toHaveBeenCalledWith(
      "Down",
      5,
      expect.objectContaining({ allowDialog: true, reason: "command:battle" })
    );
  });

  it("keeps guards before session input", async () => {
    const inputGate = {
      press: vi.fn(async (button, frames) => inputResult(button, frames)),
    };

    const result = await executeCommand(
      { type: "interact" },
      context({ mode: "battle", inputGate })
    );

    expect(result).toMatchObject({
      status: "rejected",
      reason: "mode_mismatch",
    });
    expect(inputGate.press).not.toHaveBeenCalled();
  });
});
