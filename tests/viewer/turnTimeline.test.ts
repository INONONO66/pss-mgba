import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../../viewer/src/api/types.js";
import { formatDuration, frameRange, gameActionLabel, runTurnStatus, timelineSummary, timelineTitle, turnDurationMs, turnErrorCount } from "../../viewer/src/components/turnTimeline.js";

describe("turn timeline view helpers", () => {
  it("summarizes turn lifecycle and game action details", () => {
    const turn: TurnRecord = {
      turn: 7,
      startedAt: "2026-05-26T00:00:00.000Z",
      finishedAt: "2026-05-26T00:00:01.250Z",
      frame: { before: 10, after: 20 },
      run: { status: "running" },
      toolCalls: [{ toolCallId: "call-1", toolName: "pokemon_wait", isGameAction: true }],
      timeline: [
        { sequence: 1, type: "tool-call", toolName: "pokemon_wait", isGameAction: true },
        { sequence: 2, type: "turn-error", message: "interrupted after action" },
      ],
    };

    expect(gameActionLabel(turn)).toBe("대기");
    expect(runTurnStatus(turn)).toBe("running");
    expect(frameRange(turn)).toBe("10 → 20");
    expect(turnDurationMs(turn)).toBe(1250);
    expect(formatDuration(turnDurationMs(turn))).toBe("1.3s");
    expect(turnErrorCount(turn)).toBe(1);
    expect(timelineTitle(turn.timeline![0])).toBe("#1 도구 호출 · 대기");
    expect(timelineSummary(turn.timeline![1])).toBe("interrupted after action");
  });
});
