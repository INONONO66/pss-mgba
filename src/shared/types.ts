export type RunId = string;

export type FrameNumber = number;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type HarnessStatus =
  | "running"
  | "completed"
  | "failed_timeout"
  | "failed_stuck"
  | "failed_mgba"
  | "failed_invalid_state"
  | "failed_budget"
  | "failed_llm";

export type HarnessErrorCode =
  | "MGBA_UNAVAILABLE"
  | "ROM_NOT_LOADED_OR_INVALID"
  | "INVALID_RAM_STATE"
  | "LLM_UNAVAILABLE"
  | "LLM_INVALID_OUTPUT"
  | "ACTION_REJECTED"
  | "STUCK"
  | "BUDGET_EXCEEDED"
  | "TIMEOUT"
  | "SCREENSHOT_FAILED";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: import("./errors.js").HarnessError };

export interface RunSummary {
  runId: RunId;
  status: HarnessStatus;
  startedAt: string;
  completedAt?: string;
  totalSteps: number;
  finalFrame?: FrameNumber;
  errorCode?: HarnessErrorCode;
}
