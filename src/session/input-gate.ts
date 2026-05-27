import { WINDOW_HIDDEN_Y } from "../game/mode-classification.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import { detectStateTransition } from "./transition-detector.js";
import type { InputIntent, InputResult, MiniState } from "./types.js";

const DEFAULT_SETTLE_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_STABLE_READ_COUNT = 2;
const TEXT_WINDOW_BUTTONS = new Set<MgbaButton>(["A", "B", "Start"]);

export interface InputGateController {
  pressButton(button: MgbaButton, frames: number): Promise<void>;
}

export interface InputGateStateReader {
  read(): Promise<MiniState>;
}

export interface InputGateOptions {
  readonly onResult?: (result: InputResult) => void;
  readonly pollIntervalMs?: number;
  readonly settleTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly stableReadCount?: number;
}

export interface InputGateIntentOptions {
  /**
   * When true, a visible text window is treated as a valid settled state.
   * This is used for interactions that intentionally open or advance dialog.
   */
  readonly allowDialog?: boolean;
  readonly reason?: string;
  readonly source?: InputIntent["source"];
}

interface InputGateValidation {
  readonly allowed: boolean;
  readonly reason?: string;
}

interface InputGateSettleResult {
  readonly polls: number;
  readonly state: MiniState;
  readonly timedOut: boolean;
}

export class InputGate {
  private readonly controller: InputGateController;
  private readonly onResult?: (result: InputResult) => void;
  private readonly pollIntervalMs: number;
  private readonly reader: InputGateStateReader;
  private readonly settleTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stableReadCount: number;

  constructor(input: {
    readonly controller: InputGateController;
    readonly reader: InputGateStateReader;
    readonly options?: InputGateOptions;
  }) {
    this.controller = input.controller;
    this.reader = input.reader;
    this.onResult = input.options?.onResult;
    this.pollIntervalMs =
      input.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.settleTimeoutMs =
      input.options?.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
    this.sleep =
      input.options?.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.stableReadCount =
      input.options?.stableReadCount ?? DEFAULT_STABLE_READ_COUNT;
  }

  async press(
    button: MgbaButton,
    frames: number,
    options: InputGateIntentOptions = {}
  ): Promise<InputResult> {
    const before = await this.reader.read();
    const intent = createInputIntent(button, frames, before, options);
    const validation = validateInputIntent(before, intent);

    if (!validation.allowed) {
      return this.recordResult(
        createRejectedInputResult(
          before,
          intent,
          validation.reason ?? "blocked"
        )
      );
    }

    await this.controller.pressButton(button, frames);
    const settled = await this.settle(intent);
    const after = settled.state;
    const transition = detectStateTransition(before, after);
    const reason = settled.timedOut ? "settle-timeout" : undefined;

    return this.recordResult({
      before,
      after,
      executed: true,
      intent,
      reason,
      transition,
      event: {
        kind: "input",
        phase: "input",
        mode: after.mode,
        miniState: after,
        transition,
        message: `Input ${button} executed`,
        metadata: {
          button,
          frames,
          polls: settled.polls,
          settleTimedOut: settled.timedOut,
          source: intent.source,
        },
      },
    });
  }

  private recordResult(result: InputResult): InputResult {
    try {
      this.onResult?.(result);
    } catch {
      // Observation hooks must not turn an already-decided input transaction
      // into a failed button press.
    }
    return result;
  }

  private async settle(intent: InputIntent): Promise<InputGateSettleResult> {
    const deadline = Date.now() + this.settleTimeoutMs;
    let polls = 0;
    let stableReads = 0;
    let latest = await this.reader.read();

    while (true) {
      if (isSettledForIntent(latest, intent)) {
        stableReads += 1;
        if (stableReads >= this.stableReadCount) {
          return { polls, state: latest, timedOut: false };
        }
      } else {
        stableReads = 0;
      }

      if (Date.now() >= deadline) {
        return { polls, state: latest, timedOut: true };
      }

      polls += 1;
      await this.sleep(this.pollIntervalMs);
      latest = await this.reader.read();
    }
  }
}

function createInputIntent(
  button: MgbaButton,
  frames: number,
  before: MiniState,
  options: InputGateIntentOptions
): InputIntent {
  const textAdvanceFromDialog =
    isTextWindowVisible(before) && TEXT_WINDOW_BUTTONS.has(button);

  return {
    button,
    frames,
    allowDialog: options.allowDialog ?? textAdvanceFromDialog,
    reason: options.reason,
    source: options.source ?? "agent",
  };
}

function validateInputIntent(
  state: MiniState,
  intent: InputIntent
): InputGateValidation {
  if (state.readiness.walkCounter !== 0) {
    return { allowed: false, reason: "walk-animation" };
  }

  if (state.readiness.joyIgnore !== 0) {
    return { allowed: false, reason: "joy-ignore" };
  }

  if (isTextWindowVisible(state)) {
    if (intent.allowDialog === true || TEXT_WINDOW_BUTTONS.has(intent.button)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "text-window" };
  }

  return { allowed: true };
}

function createRejectedInputResult(
  before: MiniState,
  intent: InputIntent,
  reason: string
): InputResult {
  const transition = detectStateTransition(before, before);
  return {
    before,
    after: before,
    executed: false,
    intent,
    reason,
    transition,
    event: {
      kind: "diagnostic",
      phase: "input",
      mode: before.mode,
      miniState: before,
      transition,
      message: `Input ${intent.button} rejected: ${reason}`,
      metadata: {
        button: intent.button,
        frames: intent.frames,
        reason,
        source: intent.source,
      },
    },
  };
}

function isSettledForIntent(state: MiniState, intent: InputIntent): boolean {
  if (state.readiness.walkCounter !== 0) {
    return false;
  }

  const dialogActive = isTextWindowVisible(state);
  if (dialogActive) {
    return state.readiness.joyIgnore === 0 && intent.allowDialog === true;
  }

  return state.readiness.joyIgnore === 0;
}

function isTextWindowVisible(state: MiniState): boolean {
  return state.readiness.windowY < WINDOW_HIDDEN_Y;
}
