import type { Command, CommandResult, GameMode } from "../control/CommandTypes.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";
import type { NavigateController, NavigateWorldReader, NavigateMapSource } from "./NavigateExecutor.js";
import type { InteractController, InteractStateReader } from "./InteractExecutor.js";
import type { DialogController, DialogStateReader } from "./DialogExecutor.js";
import type { BattleController } from "./BattleExecutor.js";
import type { GuardContext } from "./Guards.js";
import { executeNavigate } from "./NavigateExecutor.js";
import { executeInteract } from "./InteractExecutor.js";
import { DialogExecutor } from "./DialogExecutor.js";
import { executeBattle } from "./BattleExecutor.js";
import { validateCommand } from "./Guards.js";

export interface ExecutionContext {
  mode: GameMode;
  fullState: FullGameState;
  mapWidth: number;
  mapHeight: number;
  controller: NavigateController & InteractController & DialogController & BattleController;
  navigateWorldReader: NavigateWorldReader;
  navigateMapSource: NavigateMapSource;
  interactStateReader: InteractStateReader;
  dialogStateReader: DialogStateReader;
  sleep?: (ms: number) => Promise<void>;
}

const ALLOWED_COMMANDS: Record<GameMode, ReadonlySet<Command["type"]>> = {
  overworld: new Set(["navigate", "interact", "wait", "raw"]),
  battle: new Set(["battle", "raw"]),
  dialog: new Set(["dialog", "raw"]),
};

export async function executeCommand(command: Command, ctx: ExecutionContext): Promise<CommandResult> {
  if (!ALLOWED_COMMANDS[ctx.mode].has(command.type)) {
    return {
      status: "rejected",
      reason: "mode_mismatch",
      details: `Cannot use ${command.type} in ${ctx.mode} mode`,
    };
  }

  const guardContext: GuardContext = {
    fullState: ctx.fullState,
    mapWidth: ctx.mapWidth,
    mapHeight: ctx.mapHeight,
  };

  const guardResult = validateCommand(command, guardContext);
  if (!guardResult.valid) {
    return guardResult.result;
  }

  const sleepFn = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  switch (command.type) {
    case "navigate":
      return executeNavigate(command, ctx.controller, ctx.navigateWorldReader, ctx.navigateMapSource);
    case "interact":
      return executeInteract(command, ctx.controller, ctx.interactStateReader);
    case "dialog": {
      const dialogExecutor = new DialogExecutor(ctx.controller, ctx.dialogStateReader);
      return dialogExecutor.execute(command);
    }
    case "battle":
      return executeBattle(command, ctx.controller, ctx.fullState, ctx.dialogStateReader);
    case "wait":
      await sleepFn(command.frames * (1000 / 60));
      return { status: "success", reason: "waited", details: `Waited ${command.frames} frames` };
    case "raw":
      for (const input of command.inputs) {
        await ctx.controller.pressButton(input.button, input.frames);
      }
      return { status: "success", reason: "raw_inputs_sent", details: `Sent ${command.inputs.length} inputs` };
  }
}
