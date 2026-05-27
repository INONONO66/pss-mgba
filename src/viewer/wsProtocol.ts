export type GameButton = "A" | "B" | "Start" | "Select" | "Up" | "Down" | "Left" | "Right";

export type ServerMessageType =
  | "hello"
  | "snapshot"
  | "turn:start"
  | "agent:event"
  | "turn:recorded"
  | "summary:update"
  | "memory:update"
  | "map:update"
  | "game-state:update"
  | "console:line"
  | "agent:status"
  | "ack"
  | "error";

export interface ServerEnvelope {
  type: ServerMessageType;
  seq: number;
  runId: string;
  payload: unknown;
}

export type AgentRunMode = "new" | "continue" | "reset";

export type ClientMessage =
  | { type: "resume"; lastSeq?: number }
  | { type: "subscribe"; channels: string[] }
  | { type: "input:press"; id: string; payload: { button: GameButton; frames: number } }
  | { type: "agent:pause"; id: string }
  | { type: "agent:resume"; id: string }
  | { type: "agent:start"; id: string; payload: { mode: AgentRunMode; maxTurns?: number; loadSlot?: number } }
  | { type: "agent:stop"; id: string }
  | { type: "agent:status-request"; id: string };

const VALID_BUTTONS = new Set<string>(["A", "B", "Start", "Select", "Up", "Down", "Left", "Right"]);
const VALID_RUN_MODES = new Set<string>(["new", "continue", "reset"]);

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.type !== "string") {
      return null;
    }
    return parseByType(parsed);
  } catch {
    return null;
  }
}

function parseByType(parsed: Record<string, unknown>): ClientMessage | null {
  switch (parsed.type) {
    case "resume":
      return { type: "resume", lastSeq: typeof parsed.lastSeq === "number" ? parsed.lastSeq : 0 };
    case "input:press":
      return parseInputPress(parsed);
    case "agent:start":
      return parseAgentStart(parsed);
    case "agent:stop":
      return { type: "agent:stop", id: extractId(parsed) };
    case "agent:status-request":
      return { type: "agent:status-request", id: extractId(parsed) };
    default:
      return null;
  }
}

function parseInputPress(parsed: Record<string, unknown>): ClientMessage | null {
  const payload = parsed.payload as Record<string, unknown> | null;
  if (!payload || typeof payload.button !== "string" || !VALID_BUTTONS.has(payload.button)) {
    return null;
  }
  const frames = typeof payload.frames === "number" && Number.isFinite(payload.frames) ? payload.frames : 5;
  return {
    type: "input:press",
    id: extractId(parsed),
    payload: { button: payload.button as GameButton, frames: Math.max(1, Math.min(30, Math.trunc(frames))) },
  };
}

function parseAgentStart(parsed: Record<string, unknown>): ClientMessage | null {
  const payload = parsed.payload as Record<string, unknown> | null;
  const mode = payload?.mode;
  if (typeof mode !== "string" || !VALID_RUN_MODES.has(mode)) {
    return null;
  }
  const maxTurns = typeof payload?.maxTurns === "number" ? Math.max(1, Math.trunc(payload.maxTurns)) : undefined;
  const loadSlot = typeof payload?.loadSlot === "number" ? Math.max(1, Math.min(9, Math.trunc(payload.loadSlot))) : undefined;
  return {
    type: "agent:start",
    id: extractId(parsed),
    payload: { mode: mode as AgentRunMode, maxTurns, loadSlot },
  };
}

function extractId(parsed: Record<string, unknown>): string {
  return typeof parsed.id === "string" ? parsed.id : "";
}
