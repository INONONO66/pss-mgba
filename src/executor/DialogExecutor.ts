import type { DialogCommand, CommandResult } from "../control/CommandTypes.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";

const PRESS_FRAMES = 16;
const MAX_DIALOG_PRESSES = 120;
const WINDOW_HIDDEN_CONFIRM_COUNT = 2;

export interface DialogController {
  pressButton(button: MgbaButton, frames?: number): Promise<void>;
}

export interface DialogStateReader {
  readTextBoxId(): Promise<number>;
  readCurrentMenuItem(): Promise<number>;
  readScreenText(): Promise<string>;
  readTileAt(offset: number): Promise<number>;
  isDialogActive(): Promise<boolean>;
  isWindowVisible(): Promise<boolean>;
  isInBattle(): Promise<boolean>;
  isChoiceActive(): Promise<boolean>;
  isNamingScreenActive(): Promise<boolean>;
}

interface DialogSnapshot {
  readonly screenText: string;
  readonly windowVisible: boolean;
  readonly inBattle: boolean;
  readonly choiceActive: boolean;
  readonly namingScreenActive: boolean;
}

export class DialogExecutor {
  private readonly controller: DialogController;
  private readonly stateReader: DialogStateReader;

  constructor(controller: DialogController, stateReader: DialogStateReader) {
    this.controller = controller;
    this.stateReader = stateReader;
  }

  execute(command: DialogCommand): Promise<CommandResult> {
    switch (command.action.kind) {
      case "advance":
        return this.advance();
      case "choose":
        return this.choose(command.action.index);
      case "input_name":
        return this.inputName(command.action.name);
      default:
        return assertNever(command.action);
    }
  }

  private async advance(): Promise<CommandResult> {
    const transcript: string[] = [];
    let windowHiddenStreak = 0;
    let previousText = "";

    for (let presses = 0; presses < MAX_DIALOG_PRESSES; presses += 1) {
      const state = await this.readDialogState();

      if (state.inBattle) {
        this.recordPage(transcript, state.screenText);
        return { status: "success", reason: "battle_started", details: this.formatTranscript(transcript) };
      }

      if (state.choiceActive) {
        this.recordPage(transcript, state.screenText);
        return { status: "success", reason: "choice_appeared", details: this.formatTranscript(transcript) };
      }

      if (state.namingScreenActive) {
        this.recordPage(transcript, state.screenText);
        return { status: "success", reason: "naming_screen", details: this.formatTranscript(transcript) };
      }

      if (state.windowVisible) {
        windowHiddenStreak = 0;
        if (state.screenText === previousText) {
          this.recordPage(transcript, state.screenText);
        }
      } else {
        windowHiddenStreak += 1;
        if (windowHiddenStreak >= WINDOW_HIDDEN_CONFIRM_COUNT) {
          return { status: "success", reason: "dialog_ended", details: this.formatTranscript(transcript) };
        }
      }

      previousText = state.screenText;
      await this.controller.pressButton("A", PRESS_FRAMES);
    }

    return {
      status: "failed",
      reason: "dialog_stuck",
      details: `max_presses=${MAX_DIALOG_PRESSES}; pages=${transcript.length}`,
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

    const transcript = await this.advanceAfterChoice();

    return {
      status: "success",
      reason: "choice_made",
      details: `index=${index}${transcript.length > 0 ? `; ${this.formatTranscript(transcript)}` : ""}`,
    };
  }

  private async inputName(name: string): Promise<CommandResult> {
    await this.controller.pressButton("A", PRESS_FRAMES);
    await this.controller.pressButton("Start", PRESS_FRAMES);

    return {
      status: "success",
      reason: "name_entered",
      details: `name=${name}`,
    };
  }

  private async advanceAfterChoice(): Promise<string[]> {
    const transcript: string[] = [];
    let windowHiddenStreak = 0;
    let previousText = "";

    for (let presses = 0; presses < MAX_DIALOG_PRESSES; presses += 1) {
      const state = await this.readDialogState();

      if (state.choiceActive || state.namingScreenActive || state.inBattle) {
        this.recordPage(transcript, state.screenText);
        return transcript;
      }

      if (state.windowVisible) {
        windowHiddenStreak = 0;
        if (state.screenText === previousText) {
          this.recordPage(transcript, state.screenText);
        }
      } else {
        windowHiddenStreak += 1;
        if (windowHiddenStreak >= WINDOW_HIDDEN_CONFIRM_COUNT) {
          return transcript;
        }
      }

      previousText = state.screenText;
      await this.controller.pressButton("A", PRESS_FRAMES);
    }

    return transcript;
  }

  private async readDialogState(): Promise<DialogSnapshot> {
    const [screenText, windowVisible, inBattle, choiceActive, namingScreenActive] =
      await Promise.all([
        this.stateReader.readScreenText(),
        this.stateReader.isWindowVisible(),
        this.stateReader.isInBattle(),
        this.stateReader.isChoiceActive(),
        this.stateReader.isNamingScreenActive(),
      ]);

    return { screenText, windowVisible, inBattle, choiceActive, namingScreenActive };
  }

  private recordPage(transcript: string[], screenText: string): void {
    const trimmed = screenText.trim();
    if (trimmed.length === 0) {
      return;
    }
    const last = transcript.at(-1);
    if (last === trimmed) {
      return;
    }
    transcript.push(trimmed);
  }

  private formatTranscript(transcript: string[]): string {
    if (transcript.length === 0) {
      return "";
    }
    return `transcript=${JSON.stringify(transcript)}`;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled dialog action: ${JSON.stringify(value)}`);
}
