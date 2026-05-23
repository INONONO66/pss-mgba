import { redactSecrets } from "./redaction.js";

export interface DebugEvent {
  readonly type: string;
  readonly sequence?: number;
  readonly timestamp?: string;
  readonly payload: unknown;
}

const INTERESTING_TYPES = new Set(["decision", "action", "error", "run_finished"]);

export function formatDebugEvent(event: DebugEvent): string | undefined {
  if (!INTERESTING_TYPES.has(event.type)) {
    return undefined;
  }

  const prefix = [event.timestamp, event.type].filter(Boolean).join(" ");
  const payload = asRecord(event.payload);

  if (event.type === "decision") {
    const decision = asRecord(payload.decision);
    return redactLine(prefix, [
      `step=${formatValue(payload.step)}`,
      `frame=${formatValue(payload.frame)}`,
      `action=${formatJson(decision.action ?? null)}`,
      `confidence=${formatValue(decision.confidence)}`,
      `rationale=${truncate(String(decision.rationale ?? ""), 180)}`
    ]);
  }

  if (event.type === "action") {
    return redactLine(prefix, [
      `step=${formatValue(payload.step)}`,
      `frame=${formatValue(payload.frame)}`,
      `action=${formatJson(payload.action ?? null)}`,
      `confidence=${formatValue(payload.confidence)}`,
      `rationale=${truncate(String(payload.rationale ?? ""), 180)}`
    ]);
  }

  if (event.type === "error") {
    const error = payload.error ?? payload;
    return redactLine(prefix, [`error=${truncate(formatJson(error), 220)}`]);
  }

  return redactLine(prefix, [
    `status=${formatValue(payload.status)}`,
    `runId=${formatValue(payload.runId)}`,
    `counts=${formatJson(payload.counts ?? {})}`,
    `result=${truncate(formatJson(payload.result ?? null), 220)}`
  ]);
}

function redactLine(prefix: string, parts: readonly string[]): string {
  return redactSecrets(`${prefix} ${parts.join(" ")}`);
}

function formatValue(value: unknown): string {
  return value === undefined ? "?" : String(value);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
