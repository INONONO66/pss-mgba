import type { HarnessAction } from "../control/ActionTypes.js";
import type { HarnessStatus } from "../types.js";

export interface DetectorStatus<TCheckpoints extends { readonly completed?: boolean } = { readonly completed?: boolean }> {
  readonly status: HarnessStatus;
  readonly checkpoints: TCheckpoints;
}

export interface ProgressDetector<TState = Record<string, unknown>, TStatus extends DetectorStatus = DetectorStatus> {
  update(state: TState, action?: HarnessAction, frame?: number): TStatus;
  getStatus(): TStatus;
}
