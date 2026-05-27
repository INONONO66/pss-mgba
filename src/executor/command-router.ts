import type {
  Command,
  CommandResult,
  GameMode,
} from "../control/CommandTypes.js";
import type { FullGameState } from "../game/PokemonTypes.js";
import type { InputGate } from "../session/input-gate.js";
import type { InputResult } from "../session/types.js";
import { executeBattle } from "./BattleExecutor.js";
import { DialogExecutor } from "./DialogExecutor.js";
import { type GuardContext, validateCommand } from "./Guards.js";
import {
  executeInteract,
  type InteractStateReader,
} from "./InteractExecutor.js";
import {
  executeNavigate,
  type NavigateMapSource,
  type NavigateWorldReader,
} from "./NavigateExecutor.js";

export interface CommandRouterContext {
  readonly dialogStateReader: ConstructorParameters<typeof DialogExecutor>[1];
  readonly fullState: FullGameState;
  readonly inputGate: Pick<InputGate, "press">;
  readonly interactStateReader: InteractStateReader;
  readonly mapHeight: number;
  readonly mapWidth: number;
  readonly mode: GameMode;
  readonly navigateMapSource: NavigateMapSource;
  readonly navigateWorldReader: NavigateWorldReader;
  readonly sleep?: (ms: number) => Promise<void>;
}

const ALLOWED_COMMANDS: Record<GameMode, ReadonlySet<Command["type"]>> = {
  overworld: new Set(["navigate", "interact", "wait", "raw"]),
  battle: new Set(["battle", "raw"]),
  dialog: new Set(["dialog", "raw"]),
};

export class CommandRouter {
  private readonly ctx: CommandRouterContext;

  constructor(ctx: CommandRouterContext) {
    this.ctx = ctx;
  }

  execute(command: Command): Promise<CommandResult> {
    const modeResult = validateMode(command, this.ctx.mode);
    if (modeResult !== undefined) {
      return Promise.resolve(modeResult);
    }

    const guardResult = validateCommand(command, this.guardContext());
    if (!guardResult.valid) {
      return Promise.resolve(guardResult.result);
    }

    return this.executeValidated(command);
  }

  private async executeValidated(command: Command): Promise<CommandResult> {
    if (command.type === "wait") {
      await this.sleep(command.frames * (1000 / 60));
      return {
        status: "success",
        reason: "waited",
        details: `Waited ${command.frames} frames`,
      };
    }

    const controller = this.createController(command.type);

    try {
      if (command.type === "raw") {
        for (const input of command.inputs) {
          await controller.pressButton(input.button, input.frames);
        }
        return this.mergeInputResults(
          {
            status: "success",
            reason: "raw_inputs_sent",
            details: `Sent ${command.inputs.length} inputs`,
          },
          inputResultsOf(controller)
        );
      }

      const result = await this.executeWithController(command, controller);
      return this.mergeInputResults(result, inputResultsOf(controller));
    } catch (error) {
      if (error instanceof InputRejectedError) {
        return inputRejectionResult(error.result);
      }
      throw error;
    }
  }

  private executeWithController(
    command: Exclude<Command, { type: "raw" } | { type: "wait" }>,
    controller: SessionCommandController
  ): Promise<CommandResult> {
    switch (command.type) {
      case "navigate":
        return executeNavigate(
          command,
          controller,
          this.ctx.navigateWorldReader,
          this.ctx.navigateMapSource
        );
      case "interact":
        return executeInteract(
          command,
          controller,
          this.ctx.interactStateReader
        );
      case "dialog":
        return new DialogExecutor(
          controller,
          this.ctx.dialogStateReader
        ).execute(command);
      case "battle":
        return executeBattle(
          command,
          controller,
          this.ctx.fullState,
          this.ctx.dialogStateReader
        );
      default:
        return assertNever(command);
    }
  }

  private createController(commandType: Command["type"]) {
    return new SessionCommandController({
      commandType,
      inputGate: this.ctx.inputGate,
    });
  }

  private guardContext(): GuardContext {
    return {
      fullState: this.ctx.fullState,
      mapHeight: this.ctx.mapHeight,
      mapWidth: this.ctx.mapWidth,
    };
  }

  private mergeInputResults(
    result: CommandResult,
    inputs: readonly InputResult[]
  ): CommandResult {
    const rejected = inputs.find((input) => !input.executed);
    if (rejected === undefined) {
      return result;
    }
    return {
      ...inputRejectionResult(rejected),
    };
  }

  private sleep(ms: number): Promise<void> {
    const sleepFn =
      this.ctx.sleep ??
      ((duration) =>
        new Promise<void>((resolve) => setTimeout(resolve, duration)));
    return sleepFn(ms);
  }
}

class SessionCommandController {
  readonly results: InputResult[] = [];
  private readonly commandType: Command["type"];
  private readonly inputGate: Pick<InputGate, "press">;

  constructor(input: {
    readonly commandType: Command["type"];
    readonly inputGate: Pick<InputGate, "press">;
  }) {
    this.commandType = input.commandType;
    this.inputGate = input.inputGate;
  }

  async pressButton(
    button: Parameters<Pick<InputGate, "press">["press"]>[0],
    frames = 5
  ): Promise<void> {
    const result = await this.inputGate.press(button, frames, {
      ...commandInputIntent(this.commandType, button),
      reason: `command:${this.commandType}`,
      source: "agent",
    });
    this.results.push(result);
    if (!result.executed) {
      throw new InputRejectedError(result);
    }
  }
}

class InputRejectedError extends Error {
  readonly result: InputResult;

  constructor(result: InputResult) {
    super(result.reason ?? "input_rejected");
    this.name = "InputRejectedError";
    this.result = result;
  }
}

function validateMode(
  command: Command,
  mode: GameMode
): CommandResult | undefined {
  if (ALLOWED_COMMANDS[mode].has(command.type)) {
    return;
  }
  return {
    status: "rejected",
    reason: "mode_mismatch",
    details: `Cannot use ${command.type} in ${mode} mode`,
  };
}

function inputResultsOf(
  controller: SessionCommandController
): readonly InputResult[] {
  return controller.results;
}

function inputRejectionResult(input: InputResult): CommandResult {
  return {
    status: "rejected",
    reason: input.reason ?? "input_rejected",
    details: `InputGate rejected ${input.intent.button}: ${input.reason ?? "unknown"}`,
  };
}

function commandInputIntent(
  commandType: Command["type"],
  button: Parameters<Pick<InputGate, "press">["press"]>[0]
): { readonly allowDialog: true } | Record<string, never> {
  return commandType === "battle" ||
    commandType === "dialog" ||
    (commandType === "interact" && button === "A")
    ? { allowDialog: true }
    : {};
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
