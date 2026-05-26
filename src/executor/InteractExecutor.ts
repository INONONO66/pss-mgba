import type { InteractCommand, CommandResult, Direction } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";

const DIRECTION_BUTTON: Record<Direction, MgbaButton> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

const DIRECTION_HOLD_FRAMES = 8;
const DIRECTION_RETRY_FRAME_INCREMENT = 8;
const MAX_DIRECTION_RETRIES = 3;

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
    const turned = await turnToFace(command.direction, controller, stateReader);
    if (!turned) {
      return {
        status: "failed",
        reason: "direction_change_failed",
        details: `Could not turn to face ${command.direction} after ${MAX_DIRECTION_RETRIES} attempts`,
      };
    }
  }

  await controller.pressButton("A", 8);

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

async function turnToFace(
  direction: Direction,
  controller: InteractController,
  stateReader: InteractStateReader,
): Promise<boolean> {
  const currentFacing = await stateReader.readFacingDirection();
  if (currentFacing === direction) {
    return true;
  }

  const button = DIRECTION_BUTTON[direction];
  for (let attempt = 0; attempt < MAX_DIRECTION_RETRIES; attempt++) {
    const holdFrames = DIRECTION_HOLD_FRAMES + attempt * DIRECTION_RETRY_FRAME_INCREMENT;
    await controller.pressButton(button, holdFrames);

    const newFacing = await stateReader.readFacingDirection();
    if (newFacing === direction) {
      return true;
    }
  }

  return false;
}
