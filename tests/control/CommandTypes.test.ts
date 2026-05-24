import { describe, expect, it } from "vitest";
import type {
  BattleAction,
  BattleCommand,
  Command,
  CommandHistoryEntry,
  CommandResult,
  CommandStatus,
  Direction,
  DialogAction,
  DialogCommand,
  GameMode,
  InteractCommand,
  NavigateCommand,
  PolicyDecision,
  RawCommand,
  RawInput,
  WaitCommand
} from "../../src/control/CommandTypes.js";

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

describe("CommandTypes", () => {
  it("narrows every command and decision variant", () => {
    const direction = "up" satisfies Direction;
    const gameMode = "battle" satisfies GameMode;
    const commandStatus = "partial" satisfies CommandStatus;

    const navigateCommand = { type: "navigate", x: 12, y: 34 } satisfies NavigateCommand;
    const interactCommand = { type: "interact", direction } satisfies InteractCommand;
    const waitCommand = { type: "wait", frames: 8 } satisfies WaitCommand;

    const dialogAction = { kind: "choose", index: 3 } satisfies DialogAction;
    const dialogCommand = { type: "dialog", action: dialogAction } satisfies DialogCommand;

    const battleAction = { kind: "fight", move: "Tackle" } satisfies BattleAction;
    const battleCommand = { type: "battle", action: battleAction } satisfies BattleCommand;

    const rawInputs = [{ button: "A", frames: 1 }] satisfies RawInput[];
    const rawCommand = { type: "raw", inputs: rawInputs, reason: "fallback" } satisfies RawCommand;

    const commands = [navigateCommand, interactCommand, dialogCommand, battleCommand, waitCommand, rawCommand] satisfies Command[];

    const policyDecision: PolicyDecision = {
      command: rawCommand,
      rationale: "Use raw inputs for an emergency fallback."
    };

    const commandResult: CommandResult = {
      status: commandStatus,
      reason: "Command was partially executed.",
      details: "One queued input was skipped."
    };

    const historyEntry: CommandHistoryEntry = {
      command: navigateCommand,
      result: commandResult,
      step: 7
    };

    expect(gameMode).toBe("battle");
    expect(policyDecision.command.type).toBe("raw");
    expect(commandResult.status).toBe("partial");
    expect(historyEntry.step).toBe(7);

    for (const command of commands) {
      switch (command.type) {
        case "navigate": {
          const narrowed: NavigateCommand = command;
          expect(narrowed.x + narrowed.y).toBe(46);
          break;
        }
        case "interact": {
          const narrowed: InteractCommand = command;
          expect(narrowed.direction).toBe("up");
          break;
        }
        case "dialog": {
          const narrowed: DialogCommand = command;
          expect(narrowed.action.kind).toBe("choose");
          break;
        }
        case "battle": {
          const narrowed: BattleCommand = command;
          expect(narrowed.action.kind).toBe("fight");
          break;
        }
        case "wait": {
          const narrowed: WaitCommand = command;
          expect(narrowed.frames).toBe(8);
          break;
        }
        case "raw": {
          const narrowed: RawCommand = command;
          expect(narrowed.inputs[0]?.button).toBe("A");
          break;
        }
        default:
          assertNever(command);
      }
    }
  });
});
