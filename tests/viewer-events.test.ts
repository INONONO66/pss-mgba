import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MgbaObservation } from "../src/observation";
import type { RunTrace } from "../src/run-trace";
import {
  EVENTS_JSONL_FILENAME,
  VIEWER_EVENT_SCHEMA_VERSION,
} from "../src/viewer-events";
import { createViewerEventRecorder } from "../src/viewer-recorder";

async function readEvents(metricsDir: string): Promise<unknown[]> {
  const jsonl = await readFile(join(metricsDir, EVENTS_JSONL_FILENAME), "utf8");
  return jsonl
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

async function createTrace(): Promise<RunTrace> {
  const metricsDir = await mkdtemp(join(tmpdir(), "pss-mgba-viewer-events-"));
  return {
    iteration: 7,
    metricsDir,
    runId: "run-viewer-events",
    startedAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("ViewerEventRecorder", () => {
  it("writes observation events with Pokemon state and screenshot payloads", async () => {
    const trace = await createTrace();
    const recorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T01:02:03.000Z"),
      trace,
    });
    const observation: MgbaObservation = {
      screenshot: {
        data: "iVBORw0KGgo=",
        mediaType: "image/png",
        path: "/tmp/screenshot.png",
      },
      state: {
        battle: false,
        battleResult: 0,
        battleType: 0,
        dialogueLike: "visual-fallback",
        direction: "up",
        mapId: 12,
        menuLike: "visual-fallback",
        position: { x: 10, y: 14 },
        readStatus: "available",
      },
      status: {
        activeButtons: ["A"],
        frame: 2817,
        gameCode: "DMG-AR",
        gameTitle: "PKMN RED ST",
      },
    };

    await recorder.recordObservation(3, observation);

    await expect(readEvents(trace.metricsDir)).resolves.toEqual([
      {
        pokemonState: observation.state,
        runId: trace.runId,
        schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
        screenshot: observation.screenshot,
        status: observation.status,
        timestamp: "2026-05-24T01:02:03.000Z",
        turn: 3,
        type: "observation",
      },
    ]);
  });

  it("summarizes action plans, control calls, and matching control results", async () => {
    const trace = await createTrace();
    const recorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T01:02:03.000Z"),
      trace,
    });
    const actionPlanEvent = {
      content:
        "Before. <action_plan>Walk to the exit, then press A.</action_plan> After.",
      type: "assistant-message",
    };
    const toolCallEvent = {
      input: { button: "Up" },
      toolCallId: "call-1",
      toolName: "mgba_tap",
      type: "tool-call",
    };
    const toolResultEvent = {
      output: { ok: true, value: "pressed Up" },
      toolCallId: "call-1",
      toolName: "mgba_tap",
      type: "tool-result",
    };

    await recorder.recordEvent(actionPlanEvent, { turn: 4 });
    await recorder.recordEvent(toolCallEvent, { turn: 4 });
    await recorder.recordEvent(toolResultEvent, { turn: 4 });

    const events = await readEvents(trace.metricsDir);
    expect(events).toEqual([
      {
        runId: trace.runId,
        schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
        summary: {
          kind: "action_plan",
          text: "Walk to the exit, then press A.",
        },
        timestamp: "2026-05-24T01:02:03.000Z",
        turn: 4,
        type: "agent-event",
      },
      {
        runId: trace.runId,
        schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
        summary: {
          input: { button: "Up" },
          kind: "action_tool_call",
          toolCallId: "call-1",
          toolName: "mgba_tap",
        },
        timestamp: "2026-05-24T01:02:03.000Z",
        turn: 4,
        type: "agent-event",
      },
      {
        runId: trace.runId,
        schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
        summary: {
          kind: "action_tool_result",
          output: { ok: true, value: "pressed Up" },
          toolCallId: "call-1",
          toolName: "mgba_tap",
        },
        timestamp: "2026-05-24T01:02:03.000Z",
        turn: 4,
        type: "agent-event",
      },
    ]);
  });

  it("summarizes supervisor interventions and non-action assistant/lifecycle events", async () => {
    const trace = await createTrace();
    const recorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T01:02:03.000Z"),
      trace,
    });
    const supervisorEvent = {
      intervention: {
        detail: "normalized tap Up to hold duration 12",
        reason: "timing-normalized",
      },
      type: "supervisor-intervention",
    };

    await recorder.recordEvent(supervisorEvent, { turn: 5 });
    await recorder.recordEvent(
      { text: "I can see the player now.", type: "assistant-message" },
      { turn: 5 }
    );
    await recorder.recordEvent(
      { text: "Need pathfinding.", type: "assistant-reasoning" },
      { turn: 5 }
    );
    await recorder.recordEvent({ type: "turn-end" }, { turn: 5 });

    const events = await readEvents(trace.metricsDir);
    expect(events).toEqual([
      expect.objectContaining({
        summary: {
          kind: "supervisor_intervention",
          output: supervisorEvent.intervention,
          text: "timing-normalized: normalized tap Up to hold duration 12",
        },
      }),
      expect.objectContaining({
        summary: { kind: "assistant_text", text: "I can see the player now." },
      }),
      expect.objectContaining({
        summary: { kind: "assistant_reasoning", text: "Need pathfinding." },
      }),
      expect.objectContaining({
        summary: { kind: "lifecycle", text: "turn-end" },
      }),
    ]);
  });

  it("does not persist raw user prompt or image content from unsummarized events", async () => {
    const trace = await createTrace();
    const recorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T01:02:03.000Z"),
      trace,
    });
    const sensitiveEvent = {
      content: [
        { text: "SYSTEM PROMPT: never persist this", type: "text" },
        { image: "data:image/png;base64,SECRET_IMAGE", type: "image" },
      ],
      injectedPrompt: "hidden injected prompt",
      type: "user-message",
    };

    await recorder.recordEvent(sensitiveEvent, { turn: 6 });

    const jsonl = await readFile(
      join(trace.metricsDir, EVENTS_JSONL_FILENAME),
      "utf8"
    );
    expect(jsonl).not.toContain("SYSTEM PROMPT");
    expect(jsonl).not.toContain("SECRET_IMAGE");
    expect(jsonl).not.toContain("hidden injected prompt");
    expect(JSON.parse(jsonl) as unknown).toEqual({
      runId: trace.runId,
      schemaVersion: VIEWER_EVENT_SCHEMA_VERSION,
      summary: { kind: "other" },
      timestamp: "2026-05-24T01:02:03.000Z",
      turn: 6,
      type: "agent-event",
    });
  });
});
