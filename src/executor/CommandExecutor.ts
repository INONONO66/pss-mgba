import type {
  Command,
  CommandResult,
  GameMode,
} from "../control/CommandTypes.js";
import type { FullGameState } from "../game/PokemonTypes.js";
import type { InputGate } from "../session/input-gate.js";
import type { BattleController } from "./BattleExecutor.js";
import { CommandRouter } from "./command-router.js";
import type { DialogController, DialogStateReader } from "./DialogExecutor.js";
import type {
  InteractController,
  InteractStateReader,
} from "./InteractExecutor.js";
import type {
  NavigateController,
  NavigateMapSource,
  NavigateWorldReader,
} from "./NavigateExecutor.js";

export interface ExecutionContext {
  controller: NavigateController &
    InteractController &
    DialogController &
    BattleController;
  dialogStateReader: DialogStateReader;
  fullState: FullGameState;
  inputGate: Pick<InputGate, "press">;
  interactStateReader: InteractStateReader;
  mapHeight: number;
  mapWidth: number;
  mode: GameMode;
  navigateMapSource: NavigateMapSource;
  navigateWorldReader: NavigateWorldReader;
  sleep?: (ms: number) => Promise<void>;
}

export function executeCommand(
  command: Command,
  ctx: ExecutionContext
): Promise<CommandResult> {
  return new CommandRouter(ctx).execute(command);
}
