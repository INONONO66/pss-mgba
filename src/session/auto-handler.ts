import type { MgbaButton } from "../mgba/MgbaTypes.js";
import type { InputGate } from "./input-gate.js";
import type { InputResult, MiniState, SessionEvent } from "./types.js";

const AUTO_PRESS_BUTTON: MgbaButton = "A";
const AUTO_PRESS_FRAMES = 16;
const DIALOG_HIDDEN_CONFIRM_COUNT = 2;
const MAX_DIALOG_PRESSES = 120;
const MAX_DIALOG_FLICKER_POLLS = 10;
const MAX_BATTLE_EXIT_PRESSES = 60;
const MAX_LOCK_POLLS = 20;
const LOCK_POLL_INTERVAL_MS = 50;
const MAX_POST_BATTLE_DIALOG_ROUNDS = 5;
const MAX_POST_WARP_DIALOG_ROUNDS = 5;

export interface AutoHandlerStateReader {
  read(): Promise<MiniState>;
}

export interface AutoHandlerDialogReader {
  isChoiceActive(): Promise<boolean>;
  isNamingScreenActive(): Promise<boolean>;
}

export interface AutoHandlerBattleReader {
  isEnemyDefeated(state: MiniState): Promise<boolean>;
  isPartyWiped(state: MiniState): Promise<boolean>;
}

export interface AutoHandlerOptions {
  readonly battleExitPresses?: number;
  readonly dialogFlickerPolls?: number;
  readonly dialogHiddenConfirmCount?: number;
  readonly dialogPresses?: number;
  readonly lockPollIntervalMs?: number;
  readonly lockPolls?: number;
  readonly postBattleDialogRounds?: number;
  readonly postWarpDialogRounds?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type AutoHandlerReason =
  | "battle_ended"
  | "battle_started"
  | "choice_appeared"
  | "dialog_ended"
  | "dialog_stuck"
  | "input_rejected"
  | "naming_screen"
  | "no_action"
  | "post_warp_settled"
  | "warp_lock_stuck";

export interface AutoHandlerResult {
  readonly events: readonly SessionEvent[];
  readonly finalState: MiniState;
  readonly inputs: readonly InputResult[];
  readonly reason: AutoHandlerReason;
  readonly status: "success" | "interrupted" | "blocked" | "noop";
  readonly transcript: readonly string[];
}

export class AutoHandler {
  private readonly battleExitPresses: number;
  private readonly battleReader?: AutoHandlerBattleReader;
  private readonly dialogFlickerPolls: number;
  private readonly dialogHiddenConfirmCount: number;
  private readonly dialogPresses: number;
  private readonly dialogReader: AutoHandlerDialogReader;
  private readonly inputGate: Pick<InputGate, "press">;
  private readonly lockPollIntervalMs: number;
  private readonly lockPolls: number;
  private readonly postBattleDialogRounds: number;
  private readonly postWarpDialogRounds: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stateReader: AutoHandlerStateReader;

  constructor(input: {
    readonly battleReader?: AutoHandlerBattleReader;
    readonly dialogReader: AutoHandlerDialogReader;
    readonly inputGate: Pick<InputGate, "press">;
    readonly options?: AutoHandlerOptions;
    readonly stateReader: AutoHandlerStateReader;
  }) {
    this.battleReader = input.battleReader;
    this.dialogReader = input.dialogReader;
    this.inputGate = input.inputGate;
    this.stateReader = input.stateReader;
    this.battleExitPresses =
      input.options?.battleExitPresses ?? MAX_BATTLE_EXIT_PRESSES;
    this.dialogFlickerPolls =
      input.options?.dialogFlickerPolls ?? MAX_DIALOG_FLICKER_POLLS;
    this.dialogHiddenConfirmCount =
      input.options?.dialogHiddenConfirmCount ?? DIALOG_HIDDEN_CONFIRM_COUNT;
    this.dialogPresses = input.options?.dialogPresses ?? MAX_DIALOG_PRESSES;
    this.lockPollIntervalMs =
      input.options?.lockPollIntervalMs ?? LOCK_POLL_INTERVAL_MS;
    this.lockPolls = input.options?.lockPolls ?? MAX_LOCK_POLLS;
    this.postBattleDialogRounds =
      input.options?.postBattleDialogRounds ?? MAX_POST_BATTLE_DIALOG_ROUNDS;
    this.postWarpDialogRounds =
      input.options?.postWarpDialogRounds ?? MAX_POST_WARP_DIALOG_ROUNDS;
    this.sleep =
      input.options?.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async advanceDialog(): Promise<AutoHandlerResult> {
    return this.advanceDialogFrom(await this.stateReader.read());
  }

  async advanceBattleEnd(): Promise<AutoHandlerResult> {
    return this.advanceBattleEndFrom(await this.stateReader.read());
  }

  async handlePostBattle(): Promise<AutoHandlerResult> {
    const inputs: InputResult[] = [];
    const transcript: string[] = [];
    let state = await this.stateReader.read();
    let reason: AutoHandlerReason = "no_action";
    let status: AutoHandlerResult["status"] = "noop";

    if (state.mode === "battle") {
      const battle = await this.advanceBattleEndFrom(state);
      inputs.push(...battle.inputs);
      state = battle.finalState;
      reason = battle.reason;
      status = battle.status;
      if (battle.status === "blocked") {
        return { ...battle, inputs };
      }
    }

    for (
      let round = 0;
      round < this.postBattleDialogRounds && state.mode === "dialog";
      round += 1
    ) {
      const dialog = await this.advanceDialogFrom(state);
      inputs.push(...dialog.inputs);
      transcript.push(...dialog.transcript);
      state = dialog.finalState;
      reason = dialog.reason;
      status = dialog.status;
      if (dialog.status !== "success") {
        break;
      }
    }

    return createAutoResult(status, reason, state, inputs, transcript);
  }

  async handlePostWarp(): Promise<AutoHandlerResult> {
    const inputs: InputResult[] = [];
    const transcript: string[] = [];
    let state = await this.stateReader.read();

    for (
      let round = 0;
      round < this.postWarpDialogRounds && state.mode === "dialog";
      round += 1
    ) {
      const dialog = await this.advanceDialogFrom(state);
      inputs.push(...dialog.inputs);
      transcript.push(...dialog.transcript);
      state = dialog.finalState;
      if (dialog.reason === "battle_started") {
        return createAutoResult(
          dialog.status,
          dialog.reason,
          state,
          inputs,
          transcript
        );
      }
      if (dialog.status !== "success") {
        return createAutoResult(
          dialog.status,
          dialog.reason,
          state,
          inputs,
          transcript
        );
      }
    }

    for (let polls = 0; polls < this.lockPolls; polls += 1) {
      if (
        state.readiness.joyIgnore === 0 &&
        state.readiness.walkCounter === 0
      ) {
        return createAutoResult(
          "success",
          "post_warp_settled",
          state,
          inputs,
          transcript
        );
      }

      await this.sleep(this.lockPollIntervalMs);
      state = await this.stateReader.read();
    }

    return createAutoResult(
      "blocked",
      "warp_lock_stuck",
      state,
      inputs,
      transcript
    );
  }

  private async advanceDialogFrom(
    initialState: MiniState
  ): Promise<AutoHandlerResult> {
    const inputs: InputResult[] = [];
    const transcript: string[] = [];
    let hiddenReads = 0;
    let flickerPolls = 0;
    let presses = 0;
    let state = initialState;

    if (state.mode !== "dialog") {
      return createAutoResult("noop", "no_action", state, inputs, transcript);
    }

    while (presses < this.dialogPresses) {
      if (state.mode === "battle") {
        recordTranscriptPage(transcript, state.screenText);
        return createAutoResult(
          "success",
          "battle_started",
          state,
          inputs,
          transcript
        );
      }

      if (state.mode === "naming") {
        recordTranscriptPage(transcript, state.screenText);
        return createAutoResult(
          "interrupted",
          "naming_screen",
          state,
          inputs,
          transcript
        );
      }

      if (!isDialogVisible(state)) {
        if (state.screenText.trim().length > 0) {
          hiddenReads = 0;
          flickerPolls += 1;
          if (flickerPolls >= this.dialogFlickerPolls) {
            return createAutoResult(
              "blocked",
              "dialog_stuck",
              state,
              inputs,
              transcript
            );
          }
          await this.sleep(this.lockPollIntervalMs);
          state = await this.stateReader.read();
          continue;
        }
        flickerPolls = 0;
        hiddenReads += 1;
        if (hiddenReads >= this.dialogHiddenConfirmCount) {
          return createAutoResult(
            "success",
            "dialog_ended",
            state,
            inputs,
            transcript
          );
        }
        await this.sleep(this.lockPollIntervalMs);
        state = await this.stateReader.read();
        continue;
      }

      hiddenReads = 0;
      flickerPolls = 0;
      const stop = await this.stopDialogAdvance(state, transcript);
      if (stop !== undefined) {
        return createAutoResult(
          stop.status,
          stop.reason,
          state,
          inputs,
          transcript
        );
      }

      recordTranscriptPage(transcript, state.screenText);

      const input = await this.inputGate.press(
        AUTO_PRESS_BUTTON,
        AUTO_PRESS_FRAMES,
        {
          allowDialog: true,
          reason: "auto-dialog-advance",
          source: "auto",
        }
      );
      inputs.push(input);
      if (!input.executed) {
        return createAutoResult(
          "blocked",
          "input_rejected",
          input.after,
          inputs,
          transcript
        );
      }
      state = input.after;
      presses += 1;
    }

    return createAutoResult(
      "blocked",
      "dialog_stuck",
      state,
      inputs,
      transcript
    );
  }

  private async advanceBattleEndFrom(
    initialState: MiniState
  ): Promise<AutoHandlerResult> {
    let state = initialState;
    const inputs: InputResult[] = [];

    if (state.mode !== "battle") {
      return createAutoResult("noop", "no_action", state, inputs, []);
    }

    if (!(await this.shouldAdvanceBattleEnd(state))) {
      return createAutoResult("noop", "no_action", state, inputs, []);
    }

    for (let presses = 0; presses < this.battleExitPresses; presses += 1) {
      const input = await this.inputGate.press(
        AUTO_PRESS_BUTTON,
        AUTO_PRESS_FRAMES,
        {
          reason: "auto-battle-end",
          source: "auto",
        }
      );
      inputs.push(input);
      state = input.after;
      if (!input.executed) {
        return createAutoResult("blocked", "input_rejected", state, inputs, []);
      }
      if (state.mode !== "battle") {
        return createAutoResult("success", "battle_ended", state, inputs, []);
      }
    }

    return createAutoResult("blocked", "dialog_stuck", state, inputs, []);
  }
  private async stopDialogAdvance(
    state: MiniState,
    transcript: string[]
  ): Promise<
    | {
        readonly reason: AutoHandlerReason;
        readonly status: AutoHandlerResult["status"];
      }
    | undefined
  > {
    if (await this.dialogReader.isChoiceActive()) {
      recordTranscriptPage(transcript, state.screenText);
      return { status: "interrupted", reason: "choice_appeared" };
    }

    if (await this.dialogReader.isNamingScreenActive()) {
      recordTranscriptPage(transcript, state.screenText);
      return { status: "interrupted", reason: "naming_screen" };
    }

    return;
  }

  private async shouldAdvanceBattleEnd(state: MiniState): Promise<boolean> {
    if (this.battleReader === undefined) {
      return false;
    }
    const [enemyDefeated, partyWiped] = await Promise.all([
      this.battleReader.isEnemyDefeated(state),
      this.battleReader.isPartyWiped(state),
    ]);
    return enemyDefeated || partyWiped;
  }
}

function createAutoResult(
  status: AutoHandlerResult["status"],
  reason: AutoHandlerReason,
  finalState: MiniState,
  inputs: readonly InputResult[],
  transcript: readonly string[]
): AutoHandlerResult {
  return {
    status,
    reason,
    finalState,
    inputs,
    transcript,
    events: inputs.flatMap((input) =>
      input.event === undefined ? [] : [input.event]
    ),
  };
}

function isDialogVisible(state: MiniState): boolean {
  return state.mode === "dialog";
}

function recordTranscriptPage(transcript: string[], screenText: string): void {
  const trimmed = screenText.trim();
  if (trimmed.length === 0 || transcript.at(-1) === trimmed) {
    return;
  }
  transcript.push(trimmed);
}
