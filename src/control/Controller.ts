import { HarnessError } from "../shared/errors.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import { HarnessActionSchema } from "./ActionSchema.js";
import type { HarnessAction } from "./ActionTypes.js";

export interface ControllerClient {
  tapButton(button: MgbaButton, frames?: number): Promise<void>;
  holdButton(button: MgbaButton, frames: number): Promise<void>;
}

type ControllerSleep = (ms: number) => Promise<void>;

interface ControllerOptions {
  client: ControllerClient;
  defaultTapFrames?: number;
  defaultHoldFrames?: number;
  frameDurationMs?: number;
  sleep?: ControllerSleep;
}

const DEFAULT_TAP_FRAMES = 5;
const DEFAULT_HOLD_FRAMES = 15;
const DEFAULT_FRAME_DURATION_MS = 1000 / 60;

export class Controller {
  private readonly client: ControllerClient;
  private readonly defaultTapFrames: number;
  private readonly defaultHoldFrames: number;
  private readonly frameDurationMs: number;
  private readonly sleep: ControllerSleep;

  constructor(options: ControllerOptions) {
    this.client = options.client;
    this.defaultTapFrames = options.defaultTapFrames ?? DEFAULT_TAP_FRAMES;
    this.defaultHoldFrames = options.defaultHoldFrames ?? DEFAULT_HOLD_FRAMES;
    this.frameDurationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute(action: unknown): Promise<void> {
    const parsed = HarnessActionSchema.safeParse(action);
    if (!parsed.success) {
      throw new HarnessError("ACTION_REJECTED", "Action payload failed validation", {
        context: {
          issues: parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path }))
        }
      });
    }

    await this.executeValidated(parsed.data);
  }

  private async executeValidated(action: HarnessAction): Promise<void> {
    switch (action.type) {
      case "press":
        await this.client.holdButton(action.button, action.frames ?? this.defaultTapFrames);
        await this.sleep((action.frames ?? this.defaultTapFrames) * this.frameDurationMs);
        return;
      case "hold":
        await this.client.holdButton(action.button, action.frames ?? this.defaultHoldFrames);
        await this.sleep((action.frames ?? this.defaultHoldFrames) * this.frameDurationMs);
        return;
      case "wait":
        await this.sleep(action.frames * this.frameDurationMs);
        return;
      case "sequence":
        for (const childAction of action.actions) {
          await this.executeValidated(childAction);
        }
    }
  }
}
