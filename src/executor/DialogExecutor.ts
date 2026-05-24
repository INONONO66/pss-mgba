import type { DialogCommand, CommandResult } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";

const PRESS_FRAMES = 8;
const MAX_DIALOG_PRESSES = 30;

export interface DialogController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export interface DialogStateReader {
  readTextBoxId(): Promise<number>;
  readCurrentMenuItem(): Promise<number>;
  readScreenText(): Promise<string>;
  isDialogActive(): Promise<boolean>;
  isChoiceActive(): Promise<boolean>;
  isNamingScreenActive(): Promise<boolean>;
}

export class DialogExecutor {
  constructor(
    private readonly controller: DialogController,
    private readonly stateReader: DialogStateReader,
  ) {}

  async execute(command: DialogCommand): Promise<CommandResult> {
    switch (command.action.kind) {
      case "advance":
        return this.advance();
      case "choose":
        return this.choose(command.action.index);
      case "input_name":
        return this.inputName(command.action.name);
    }
  }

  private async advance(): Promise<CommandResult> {
    let previousText = await this.stateReader.readScreenText();
    let textChanged = false;

    for (let presses = 1; presses <= MAX_DIALOG_PRESSES; presses += 1) {
      await this.controller.pressButton("A", PRESS_FRAMES);

      const state = await this.readDialogState();
      if (state.screenText !== previousText) {
        textChanged = true;
      }
      previousText = state.screenText;

      const terminalResult = this.resultForTerminalState(state);
      if (terminalResult !== undefined) {
        return terminalResult;
      }
    }

    return {
      status: "failed",
      reason: "dialog_stuck",
      details: `max_presses=${MAX_DIALOG_PRESSES}; text_changed=${textChanged}`,
    };
  }

  private async choose(index: number): Promise<CommandResult> {
    const currentMenuItem = await this.stateReader.readCurrentMenuItem();
    const delta = index - currentMenuItem;
    const button: MgbaButton = delta >= 0 ? "Down" : "Up";

    for (let step = 0; step < Math.abs(delta); step += 1) {
      await this.controller.pressButton(button, PRESS_FRAMES);
    }

    await this.controller.pressButton("A", PRESS_FRAMES);
    await this.advanceAfterChoice();

    return {
      status: "success",
      reason: "choice_made",
      details: `index=${index}`,
    };
  }

  private async inputName(name: string): Promise<CommandResult> {
    // Full Gen1 keyboard navigation can be added here later.
    await this.controller.pressButton("A", PRESS_FRAMES);
    await this.controller.pressButton("Start", PRESS_FRAMES);

    return {
      status: "success",
      reason: "name_entered",
      details: `name=${name}`,
    };
  }

  private async advanceAfterChoice(): Promise<void> {
    for (let presses = 0; presses < MAX_DIALOG_PRESSES; presses += 1) {
      const state = await this.readDialogState();
      const terminalResult = this.resultForTerminalState(state);
      if (terminalResult !== undefined) {
        return;
      }

      await this.controller.pressButton("A", PRESS_FRAMES);
    }
  }

  private async readDialogState(): Promise<{
    textBoxId: number;
    screenText: string;
    dialogActive: boolean;
    choiceActive: boolean;
    namingScreenActive: boolean;
  }> {
    const [textBoxId, screenText, dialogActive, choiceActive, namingScreenActive] =
      await Promise.all([
        this.stateReader.readTextBoxId(),
        this.stateReader.readScreenText(),
        this.stateReader.isDialogActive(),
        this.stateReader.isChoiceActive(),
        this.stateReader.isNamingScreenActive(),
      ]);

    return { textBoxId, screenText, dialogActive, choiceActive, namingScreenActive };
  }

  private resultForTerminalState(state: {
    textBoxId: number;
    screenText: string;
    dialogActive: boolean;
    choiceActive: boolean;
    namingScreenActive: boolean;
  }): CommandResult | undefined {
    if (state.choiceActive) {
      return {
        status: "success",
        reason: "choice_appeared",
        details: state.screenText.length > 0 ? `choices=${state.screenText}` : undefined,
      };
    }

    if (state.namingScreenActive) {
      return { status: "success", reason: "naming_screen" };
    }

    if (state.textBoxId === 0 && state.screenText.trim().length === 0 && !state.dialogActive) {
      return { status: "success", reason: "dialog_ended" };
    }

    return undefined;
  }
}
