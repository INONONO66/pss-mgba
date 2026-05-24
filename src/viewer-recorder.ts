import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MgbaObservation } from "./observation";
import type { RunTrace } from "./run-trace";
import {
  type AgentViewerEvent,
  EVENTS_JSONL_FILENAME,
  type ObservationViewerEvent,
  VIEWER_EVENT_SCHEMA_VERSION,
  type ViewerEvent,
  type ViewerEventSummary,
} from "./viewer-events";

const CONTROL_TOOLS = new Set([
  "mgba_tap",
  "mgba_tap_many",
  "mgba_hold",
  "mgba_hold_many",
  "mgba_release",
]);

const ACTION_PLAN_PATTERN = /<action_plan>([\s\S]*?)<\/action_plan>/i;

const LIFECYCLE_EVENTS = new Set([
  "run-start",
  "run-end",
  "run-abort",
  "run-error",
  "turn-start",
  "turn-end",
  "turn-abort",
  "turn-error",
  "step-start",
  "step-end",
  "step-abort",
  "step-error",
]);

export interface ViewerEventRecorderOptions {
  now?: () => Date;
  trace: Pick<RunTrace, "metricsDir" | "runId">;
}

export interface RecordEventOptions {
  turn?: number;
}

export function createViewerEventRecorder(
  options: ViewerEventRecorderOptions
): ViewerEventRecorder {
  return new ViewerEventRecorder(options);
}

export class ViewerEventRecorder {
  readonly #eventsPath: string;
  readonly #now: () => Date;
  readonly #runId: string;

  constructor({ now = () => new Date(), trace }: ViewerEventRecorderOptions) {
    this.#eventsPath = join(trace.metricsDir, EVENTS_JSONL_FILENAME);
    this.#now = now;
    this.#runId = trace.runId;
  }

  async recordObservation(
    turn: number,
    observation: MgbaObservation
  ): Promise<void> {
    const event = {
      schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
      type: "observation",
      timestamp: this.#timestamp(),
      runId: this.#runId,
      turn,
      status: observation.status,
      ...(observation.state ? { pokemonState: observation.state } : {}),
      screenshot: observation.screenshot,
    } satisfies ObservationViewerEvent;

    await this.#append(event);
  }

  async recordEvent(
    event: unknown,
    { turn }: RecordEventOptions = {}
  ): Promise<void> {
    const viewerEvent = {
      schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
      type: "agent-event",
      timestamp: this.#timestamp(),
      runId: this.#runId,
      ...(turn === undefined ? {} : { turn }),
      summary: summarizeEvent(event),
    } satisfies AgentViewerEvent;

    await this.#append(viewerEvent);
  }

  async #append(event: ViewerEvent): Promise<void> {
    await mkdir(dirname(this.#eventsPath), { recursive: true });
    await appendFile(this.#eventsPath, `${JSON.stringify(event)}\n`);
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

export function summarizeEvent(event: unknown): ViewerEventSummary {
  const supervisorIntervention = summarizeSupervisorIntervention(event);
  if (supervisorIntervention) {
    return supervisorIntervention;
  }

  const toolSummary = summarizeControlToolEvent(event);
  if (toolSummary) {
    return toolSummary;
  }

  const reasoningText = extractReasoningText(event);
  if (reasoningText !== undefined) {
    return { kind: "assistant_reasoning", text: reasoningText };
  }

  const assistantText = extractAssistantText(event);
  if (assistantText !== undefined) {
    const actionPlan = extractActionPlan(assistantText);
    return actionPlan
      ? { kind: "action_plan", text: actionPlan }
      : { kind: "assistant_text", text: assistantText };
  }

  const type = stringProperty(event, "type");
  if (type && LIFECYCLE_EVENTS.has(type)) {
    return { kind: "lifecycle", text: type };
  }

  return { kind: "other" };
}

function summarizeControlToolEvent(
  event: unknown
): ViewerEventSummary | undefined {
  const type = stringProperty(event, "type");
  const toolName = stringProperty(event, "toolName");
  if (!(toolName && CONTROL_TOOLS.has(toolName))) {
    return;
  }

  const toolCallId = stringProperty(event, "toolCallId");
  if (type === "tool-call") {
    return {
      kind: "action_tool_call",
      toolName,
      ...(toolCallId ? { toolCallId } : {}),
      input: property(event, "input"),
    };
  }

  if (type === "tool-result") {
    return {
      kind: "action_tool_result",
      toolName,
      ...(toolCallId ? { toolCallId } : {}),
      output: property(event, "output"),
    };
  }
}

function summarizeSupervisorIntervention(
  event: unknown
): ViewerEventSummary | undefined {
  if (stringProperty(event, "type") !== "supervisor-intervention") {
    return;
  }

  const intervention = property(event, "intervention");
  const detail = stringProperty(intervention, "detail");
  const reason = stringProperty(intervention, "reason");
  const text = [reason, detail].filter(Boolean).join(": ");

  return {
    kind: "supervisor_intervention",
    ...(text ? { text } : {}),
    output: intervention,
  };
}

function extractAssistantText(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return;
  }

  const type = stringProperty(event, "type");
  if (type && !type.includes("assistant") && type !== "text") {
    return;
  }

  return (
    stringProperty(event, "text") ??
    extractTextFromContent(property(event, "content")) ??
    extractTextFromContent(property(property(event, "message"), "content"))
  );
}

function extractReasoningText(event: unknown): string | undefined {
  const type = stringProperty(event, "type");
  if (type !== "reasoning" && type !== "assistant-reasoning") {
    return;
  }

  return (
    stringProperty(event, "text") ??
    stringProperty(event, "reasoning") ??
    extractTextFromContent(property(event, "content"))
  );
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return;
  }

  const text = content
    .map((part) => stringProperty(part, "text"))
    .filter((part): part is string => part !== undefined)
    .join("\n");
  return text || undefined;
}

function extractActionPlan(text: string): string | undefined {
  const match = ACTION_PLAN_PATTERN.exec(text);
  return match?.[1]?.trim();
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  const result = property(value, key);
  return typeof result === "string" ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
