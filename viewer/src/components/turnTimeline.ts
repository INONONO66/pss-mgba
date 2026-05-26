import type { TurnRecord, TurnTimelineEvent } from "../api/types";
import { actionLabel } from "./labels";
import { isRecord, value } from "./shared";

export type TimelineTone = "seeing" | "thinking" | "deciding" | "error" | "state";

export function timelineTone(event: TurnTimelineEvent): TimelineTone {
  if (event.type === "turn-error") return "error";
  if (event.type === "assistant-reasoning") return "thinking";
  if (event.type === "tool-call" || event.type === "tool-result") return "deciding";
  if (event.type === "assistant-text") return "seeing";
  return "state";
}

export function timelineTitle(event: TurnTimelineEvent): string {
  const prefix = event.sequence ? `#${event.sequence} ` : "";
  switch (event.type) {
    case "assistant-reasoning": return `${prefix}추론`;
    case "assistant-text": return `${prefix}응답`;
    case "tool-call": return `${prefix}도구 호출 · ${actionLabel(event.toolName)}`;
    case "tool-result": return `${prefix}도구 결과 · ${actionLabel(event.toolName)}`;
    case "turn-error": return `${prefix}오류`;
    default: return `${prefix}${event.type}`;
  }
}

export function timelineSummary(event: TurnTimelineEvent): string {
  if (typeof event.message === "string" && event.message.length > 0) return event.message;
  if (typeof event.text === "string" && event.text.length > 0) return event.text;
  if (event.type === "tool-call") return `${event.isGameAction ? "게임 행동" : "보조 기록"} 호출`;
  if (event.type === "tool-result") return event.isGameAction ? "게임 행동 결과 수신" : "보조 기록 결과 수신";
  return event.type;
}

export function timelinePayload(event: TurnTimelineEvent): unknown {
  if (event.type === "tool-call") return event.input;
  if (event.type === "tool-result") return event.output ?? event.result ?? event.command;
  return undefined;
}

export function turnErrorCount(turn: TurnRecord): number {
  return (turn.timeline ?? []).filter((event) => event.type === "turn-error").length;
}

export function gameActionLabel(turn: TurnRecord): string {
  const call = turn.toolCalls?.find((entry) => entry.isGameAction) ?? turn.toolCalls?.[0];
  return actionLabel(call?.toolName);
}

export function turnDurationMs(turn: TurnRecord): number | undefined {
  if (!turn.startedAt || !turn.finishedAt) return undefined;
  const started = Date.parse(turn.startedAt);
  const finished = Date.parse(turn.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return undefined;
  return Math.max(0, finished - started);
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function detectorStatus(turn: TurnRecord): string {
  const detector = turn.detector;
  return isRecord(detector) ? value(detector.status) : "?";
}

export function frameRange(turn: TurnRecord): string {
  const frame = turn.frame;
  if (!isRecord(frame)) return "?";
  return `${value(frame.before)} → ${value(frame.after)}`;
}

export function runTurnStatus(turn: TurnRecord): string {
  return value(turn.run?.status, "running");
}

export function sortedTurns(payload: { turns?: TurnRecord[] } | null): TurnRecord[] {
  return [...(payload?.turns ?? [])].sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0));
}

export function eventsForTurn(turn: TurnRecord): TurnTimelineEvent[] {
  if ((turn.timeline?.length ?? 0) > 0) return turn.timeline ?? [];
  return (turn.toolCalls ?? []).flatMap((call, index) => [
    {
      sequence: index * 2 + 1,
      type: "tool-call",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
      isGameAction: call.isGameAction,
    },
    {
      sequence: index * 2 + 2,
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: call.output,
      isGameAction: call.isGameAction,
    },
  ]);
}
