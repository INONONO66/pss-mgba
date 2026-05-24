import type { InteractCommand, CommandResult, Direction } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";

const DIRECTION_BUTTON: Record<Direction, MgbaButton> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

export interface InteractController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export interface InteractStateReader {
  readFacingDirection(): Promise<string>;
  isDialogActive(): Promise<boolean>;
}

export async function executeInteract(
  command: InteractCommand,
  controller: InteractController,
  stateReader: InteractStateReader,
): Promise<CommandResult> {
  if (command.direction !== undefined) {
    const currentFacing = await stateReader.readFacingDirection();
    if (currentFacing !== command.direction) {
      await controller.pressButton(DIRECTION_BUTTON[command.direction], 5);
    }
  }

  await controller.pressButton("A", 5);

  if (await stateReader.isDialogActive()) {
    return {
      status: "success",
      reason: "dialog_started",
      details: "Interaction triggered dialog",
    };
  }

  return {
    status: "success",
    reason: "interacted",
    details: "Pressed A",
  };
}
