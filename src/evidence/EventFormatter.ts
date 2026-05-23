export type DebugEvent = {
  type: string;
  timestamp: string;
  sequence?: number;
  payload?: unknown;
};

export function formatDebugEvent(event: DebugEvent): string | undefined {
  const prefix = formatPrefix(event);

  switch (event.type) {
    case "decision":
      return `${prefix} decision ${formatPayloadSummary(event.payload, ["action", "rationale", "provider"])}`;
    case "action":
      return `${prefix} action ${formatPayloadSummary(event.payload, ["button", "input", "frames", "duration"])}`;
    case "error":
      return `${prefix} error ${formatPayloadSummary(event.payload, ["message", "code", "cause"])}`;
    case "run_finished":
      return `${prefix} run_finished ${formatPayloadSummary(event.payload, ["status", "steps", "durationMs"])}`;
    default:
      return undefined;
  }
}

function formatPrefix(event: DebugEvent): string {
  const sequence = event.sequence === undefined ? "" : ` #${event.sequence}`;
  return `${event.timestamp}${sequence}`;
}

function formatPayloadSummary(payload: unknown, preferredKeys: string[]): string {
  if (!isRecord(payload)) {
    return stringifyPrimitive(payload);
  }

  const parts = preferredKeys.flatMap((key) => {
    const value = payload[key];
    return value === undefined ? [] : [`${key}=${stringifyPrimitive(value)}`];
  });

  if (parts.length > 0) {
    return parts.join(" ");
  }

  const firstEntries = Object.entries(payload).slice(0, 4);
  if (firstEntries.length === 0) {
    return "{}";
  }

  return firstEntries
    .map(([key, value]) => `${key}=${stringifyPrimitive(value)}`)
    .join(" ");
}

function stringifyPrimitive(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  }
  if (isRecord(value)) {
    return "{...}";
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
