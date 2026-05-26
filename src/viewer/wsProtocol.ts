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
  | "ack"
  | "error";

export interface ServerEnvelope {
  type: ServerMessageType;
  seq: number;
  runId: string;
  payload: unknown;
}

export type ClientMessage =
  | { type: "resume"; lastSeq?: number }
  | { type: "subscribe"; channels: string[] }
  | { type: "input:press"; id: string; payload: { button: GameButton; frames: number } }
  | { type: "agent:pause"; id: string }
  | { type: "agent:resume"; id: string };

const VALID_BUTTONS = new Set<string>(["A", "B", "Start", "Select", "Up", "Down", "Left", "Right"]);

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.type !== "string") {
      return null;
    }

    if (parsed.type === "resume") {
      const lastSeq = typeof parsed.lastSeq === "number" ? parsed.lastSeq : 0;
      return { type: "resume", lastSeq };
    }

    if (parsed.type === "input:press") {
      const payload = parsed.payload as Record<string, unknown> | null;
      if (!payload || typeof payload.button !== "string" || !VALID_BUTTONS.has(payload.button)) {
        return null;
      }
      const frames = typeof payload.frames === "number" && Number.isFinite(payload.frames) ? payload.frames : 5;
      return {
        type: "input:press",
        id: typeof parsed.id === "string" ? parsed.id : "",
        payload: { button: payload.button as GameButton, frames: Math.max(1, Math.min(30, Math.trunc(frames))) },
      };
    }

    return null;
  } catch {
    return null;
  }
}
