import { createHash } from "node:crypto";
import type { AgentEvent } from "@minpeter/pss-runtime";
import type { ExperimentMode } from "./run-trace";
import type {
  SupervisorInterventionEvent,
  SupervisorInterventionReason,
} from "./supervisor";

const CONTROL_TOOLS = new Set([
  "mgba_tap",
  "mgba_tap_many",
  "mgba_hold",
  "mgba_hold_many",
  "mgba_release",
]);

export interface RunMetricsSnapshot {
  aButtonControlCalls: number;
  actionEntropy: number;
  controlToolCalls: number;
  currentStepStartedAt: number | undefined;
  currentTurnStartedAt: number | undefined;
  failedToolCalls: number;
  lastStepDurationMs: number;
  lastToolDurationMs: number;
  lastTurnDurationMs: number;
  maxSameActionStreak: number;
  observeBeforeActRatio: number;
  sameActionStreak: number;
  screenChangedCount: number;
  screenshotCalls: number;
  screenUnchangedStreak: number;
  statusCalls: number;
  stepCount: number;
  stuckEvents: number;
  supervisorInterventions: number;
  toolCalls: number;
  toolErrorRate: number;
  turnCount: number;
  turnsWithControl: number;
  turnsWithObserveBeforeControl: number;
  uniqueActionCount: number;
  uniqueScreenCount: number;
}

interface PendingToolCall {
  input: unknown;
  startedAt: number;
  toolName: string;
}

export interface RunMetricsTrackerOptions {
  experimentId?: string;
  iteration?: number;
  mode?: ExperimentMode;
  runId?: string;
}

export class RunMetricsTracker {
  readonly #actionCounts = new Map<string, number>();
  readonly #pendingToolCalls = new Map<string, PendingToolCall>();
  readonly #screenHashes = new Set<string>();
  #aButtonControlCalls = 0;
  #controlToolCalls = 0;
  #currentStepStartedAt: number | undefined;
  #currentTurnHadControl = false;
  #currentTurnHadObservation = false;
  #currentTurnStartedAt: number | undefined;
  #failedToolCalls = 0;
  #lastActionKey: string | undefined;
  #lastScreenHash: string | undefined;
  #lastStepDurationMs = 0;
  #lastToolDurationMs = 0;
  #lastTurnDurationMs = 0;
  #maxSameActionStreak = 0;
  #sameActionStreak = 0;
  #screenChangedCount = 0;
  #screenUnchangedStreak = 0;
  #screenshotCalls = 0;
  #statusCalls = 0;
  #stuckEvents = 0;
  #supervisorInterventions = 0;
  #stepCount = 0;
  #toolCalls = 0;
  #turnCount = 0;
  #turnsWithControl = 0;
  #turnsWithObserveBeforeControl = 0;
  readonly #experimentId: string | undefined;
  readonly #iteration: number;
  readonly #mode: ExperimentMode | undefined;
  readonly #runId: string;

  constructor({
    experimentId,
    iteration = 0,
    mode,
    runId = "unknown",
  }: RunMetricsTrackerOptions = {}) {
    this.#experimentId = experimentId;
    this.#iteration = iteration;
    this.#mode = mode;
    this.#runId = runId;
  }

  recordEvent(
    event: AgentEvent | SupervisorInterventionEvent,
    now = Date.now()
  ): void {
    if (event.type === "supervisor-intervention") {
      this.recordSupervisorIntervention(event.intervention.reason);
      return;
    }

    switch (event.type) {
      case "turn-start":
        this.#turnCount += 1;
        this.#currentTurnStartedAt = now;
        this.#currentTurnHadControl = false;
        this.#currentTurnHadObservation = false;
        return;
      case "turn-end":
      case "turn-abort":
      case "turn-error":
        if (this.#currentTurnStartedAt !== undefined) {
          this.#lastTurnDurationMs = now - this.#currentTurnStartedAt;
        }
        return;
      case "step-start":
        this.#stepCount += 1;
        this.#currentStepStartedAt = now;
        return;
      case "step-end":
        if (this.#currentStepStartedAt !== undefined) {
          this.#lastStepDurationMs = now - this.#currentStepStartedAt;
        }
        return;
      case "tool-call":
        this.#recordToolCall(event, now);
        return;
      case "tool-result":
        this.#recordToolResult(event, now);
        return;
      default:
        return;
    }
  }

  recordSupervisorIntervention(_reason: SupervisorInterventionReason): void {
    this.#supervisorInterventions += 1;
  }

  recordStuckEvents(stuckEvents: number): void {
    this.#stuckEvents = Math.max(this.#stuckEvents, stuckEvents);
  }

  prometheusMetrics(): string {
    const snapshot = this.snapshot();
    return [
      "# HELP pss_mgba_tool_calls_total Total tool calls in the current process by category.",
      "# TYPE pss_mgba_tool_calls_total counter",
      `pss_mgba_tool_calls_total${this.#labels("all")} ${snapshot.toolCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("control")} ${snapshot.controlToolCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("screenshot")} ${snapshot.screenshotCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("status")} ${snapshot.statusCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("failed")} ${snapshot.failedToolCalls}`,
      "# HELP pss_mgba_supervisor_interventions_total Total local supervisor action overrides or waits.",
      "# TYPE pss_mgba_supervisor_interventions_total counter",
      `pss_mgba_supervisor_interventions_total${this.#labels()} ${snapshot.supervisorInterventions}`,
      "# HELP pss_mgba_stuck_events_total Repeated failed movement detections in the current run.",
      "# TYPE pss_mgba_stuck_events_total counter",
      `pss_mgba_stuck_events_total${this.#labels()} ${snapshot.stuckEvents}`,
      "# HELP pss_mgba_control_a_button_ratio Ratio of control tool calls that include A.",
      "# TYPE pss_mgba_control_a_button_ratio gauge",
      `pss_mgba_control_a_button_ratio${this.#labels()} ${ratio(snapshot.aButtonControlCalls, snapshot.controlToolCalls)}`,
      "# HELP pss_mgba_action_entropy Diversity of control actions in bits. Lower values indicate repetitive controls.",
      "# TYPE pss_mgba_action_entropy gauge",
      `pss_mgba_action_entropy${this.#labels()} ${snapshot.actionEntropy}`,
      "# HELP pss_mgba_same_action_streak Current and max repeated same-action streak.",
      "# TYPE pss_mgba_same_action_streak gauge",
      `pss_mgba_same_action_streak${this.#labels("current")} ${snapshot.sameActionStreak}`,
      `pss_mgba_same_action_streak${this.#labels("max")} ${snapshot.maxSameActionStreak}`,
      "# HELP pss_mgba_visual_novelty Screens observed and changed.",
      "# TYPE pss_mgba_visual_novelty gauge",
      `pss_mgba_visual_novelty${this.#labels("unique_screens")} ${snapshot.uniqueScreenCount}`,
      `pss_mgba_visual_novelty${this.#labels("screen_changes")} ${snapshot.screenChangedCount}`,
      `pss_mgba_visual_novelty${this.#labels("unchanged_streak")} ${snapshot.screenUnchangedStreak}`,
      "# HELP pss_mgba_observe_before_act_ratio Ratio of control turns where observation happened before control.",
      "# TYPE pss_mgba_observe_before_act_ratio gauge",
      `pss_mgba_observe_before_act_ratio${this.#labels()} ${snapshot.observeBeforeActRatio}`,
      "# HELP pss_mgba_duration_ms Last observed duration by kind.",
      "# TYPE pss_mgba_duration_ms gauge",
      `pss_mgba_duration_ms${this.#labels("turn")} ${snapshot.lastTurnDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("step")} ${snapshot.lastStepDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("tool")} ${snapshot.lastToolDurationMs}`,
      "# HELP pss_mgba_tool_error_rate Failed tool calls divided by all tool calls.",
      "# TYPE pss_mgba_tool_error_rate gauge",
      `pss_mgba_tool_error_rate${this.#labels()} ${snapshot.toolErrorRate}`,
      "",
    ].join("\n");
  }

  snapshot(): RunMetricsSnapshot {
    return {
      aButtonControlCalls: this.#aButtonControlCalls,
      actionEntropy: entropy([...this.#actionCounts.values()]),
      controlToolCalls: this.#controlToolCalls,
      currentStepStartedAt: this.#currentStepStartedAt,
      currentTurnStartedAt: this.#currentTurnStartedAt,
      failedToolCalls: this.#failedToolCalls,
      lastStepDurationMs: this.#lastStepDurationMs,
      lastToolDurationMs: this.#lastToolDurationMs,
      lastTurnDurationMs: this.#lastTurnDurationMs,
      maxSameActionStreak: this.#maxSameActionStreak,
      observeBeforeActRatio: ratio(
        this.#turnsWithObserveBeforeControl,
        this.#turnsWithControl
      ),
      sameActionStreak: this.#sameActionStreak,
      screenshotCalls: this.#screenshotCalls,
      screenChangedCount: this.#screenChangedCount,
      screenUnchangedStreak: this.#screenUnchangedStreak,
      statusCalls: this.#statusCalls,
      supervisorInterventions: this.#supervisorInterventions,
      stuckEvents: this.#stuckEvents,
      stepCount: this.#stepCount,
      toolCalls: this.#toolCalls,
      toolErrorRate: ratio(this.#failedToolCalls, this.#toolCalls),
      turnCount: this.#turnCount,
      turnsWithControl: this.#turnsWithControl,
      turnsWithObserveBeforeControl: this.#turnsWithObserveBeforeControl,
      uniqueActionCount: this.#actionCounts.size,
      uniqueScreenCount: this.#screenHashes.size,
    };
  }

  #labels(category?: string): string {
    const entries = [
      `run_id="${escapeLabel(this.#runId)}"`,
      `iteration="${this.#iteration}"`,
    ];
    if (this.#mode) {
      entries.push(`mode="${escapeLabel(this.#mode)}"`);
    }
    if (this.#experimentId) {
      entries.push(`experiment_id="${escapeLabel(this.#experimentId)}"`);
    }
    if (category) {
      entries.push(`category="${escapeLabel(category)}"`);
      entries.push(`kind="${escapeLabel(category)}"`);
    }
    return `{${entries.join(",")}}`;
  }

  #recordToolCall(
    event: Extract<AgentEvent, { type: "tool-call" }>,
    now: number
  ): void {
    this.#toolCalls += 1;
    this.#pendingToolCalls.set(event.toolCallId, {
      input: event.input,
      startedAt: now,
      toolName: event.toolName,
    });

    if (event.toolName === "mgba_screenshot") {
      this.#screenshotCalls += 1;
      this.#currentTurnHadObservation = true;
      return;
    }

    if (event.toolName === "mgba_status") {
      this.#statusCalls += 1;
      this.#currentTurnHadObservation = true;
      return;
    }

    if (CONTROL_TOOLS.has(event.toolName)) {
      this.#recordControl(event.toolName, event.input);
    }
  }

  #recordToolResult(
    event: Extract<AgentEvent, { type: "tool-result" }>,
    now: number
  ): void {
    const pending = this.#pendingToolCalls.get(event.toolCallId);
    if (pending) {
      this.#lastToolDurationMs = now - pending.startedAt;
      this.#pendingToolCalls.delete(event.toolCallId);
    }

    if (isToolError(event.output)) {
      this.#failedToolCalls += 1;
    }

    if (event.toolName === "mgba_screenshot") {
      this.#recordScreenshotResult(event.output);
    }
  }

  #recordControl(toolName: string, input: unknown): void {
    this.#controlToolCalls += 1;
    if (!this.#currentTurnHadControl) {
      this.#turnsWithControl += 1;
      if (this.#currentTurnHadObservation) {
        this.#turnsWithObserveBeforeControl += 1;
      }
      this.#currentTurnHadControl = true;
    }

    const buttons = extractButtons(input);
    if (buttons.includes("A")) {
      this.#aButtonControlCalls += 1;
    }

    const actionKey = `${toolName}:${buttons.join("+") || JSON.stringify(input)}`;
    this.#actionCounts.set(
      actionKey,
      (this.#actionCounts.get(actionKey) ?? 0) + 1
    );
    if (this.#lastActionKey === actionKey) {
      this.#sameActionStreak += 1;
    } else {
      this.#sameActionStreak = 1;
      this.#lastActionKey = actionKey;
    }
    this.#maxSameActionStreak = Math.max(
      this.#maxSameActionStreak,
      this.#sameActionStreak
    );
  }

  #recordScreenshotResult(output: unknown): void {
    const data = extractScreenshotData(output);
    if (!data) {
      return;
    }

    const hash = createHash("sha256").update(data).digest("hex");
    this.#screenHashes.add(hash);
    if (this.#lastScreenHash && this.#lastScreenHash !== hash) {
      this.#screenChangedCount += 1;
      this.#screenUnchangedStreak = 0;
    } else if (this.#lastScreenHash === hash) {
      this.#screenUnchangedStreak += 1;
    }
    this.#lastScreenHash = hash;
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function extractButtons(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as { button?: unknown; buttons?: unknown };
  if (typeof record.button === "string") {
    return [record.button];
  }
  if (Array.isArray(record.buttons)) {
    return record.buttons.filter(
      (button): button is string => typeof button === "string"
    );
  }
  return [];
}

function extractScreenshotData(output: unknown): string | undefined {
  if (!output || typeof output !== "object") {
    return;
  }
  const value =
    "value" in output ? (output as { value?: unknown }).value : output;
  if (!value || typeof value !== "object") {
    return;
  }
  const data = (value as { data?: unknown }).data;
  return typeof data === "string" ? data : undefined;
}

function isToolError(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  const value =
    "value" in output ? (output as { value?: unknown }).value : output;
  if (typeof value === "string") {
    return value.toLowerCase().includes("error");
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { ok?: unknown; type?: unknown };
  return record.ok === false || record.type === "error-text";
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 0;
  }
  return counts.reduce((sum, count) => {
    const probability = count / total;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
