import { describe, expect, it } from "vitest";
import { formatDebugEvent } from "../src/evidence/EventFormatter";

describe("formatDebugEvent", () => {
  it("formats known event summaries without leaking full payloads", () => {
    expect(formatDebugEvent({
      type: "decision",
      sequence: 7,
      timestamp: "2026-05-24T00:00:00.000Z",
      payload: { action: "press_b", rationale: "safe", ignored: "not shown" },
    })).toBe('2026-05-24T00:00:00.000Z #7 decision action="press_b" rationale="safe"');
  });

  it("returns undefined for unknown event types", () => {
    expect(formatDebugEvent({
      type: "state",
      timestamp: "2026-05-24T00:00:00.000Z",
      payload: {},
    })).toBeUndefined();
  });
});
