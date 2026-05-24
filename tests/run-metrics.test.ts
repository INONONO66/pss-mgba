import type { AgentEvent } from "@minpeter/pss-runtime";
import { describe, expect, it } from "vitest";
import type { MgbaObservation } from "../src/observation";
import type { PokemonStateObservation } from "../src/pokemon-state";
import { RunMetricsTracker } from "../src/run-metrics";
import { StuckMemory } from "../src/stuck-memory";

const baseState: PokemonStateObservation = {
  battle: false,
  battleResult: 0,
  battleType: 0,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 12,
  menuLike: "visual-fallback",
  position: {
    x: 10,
    y: 14,
  },
  readStatus: "available",
};

function observation(
  state: PokemonStateObservation | undefined = baseState
): MgbaObservation {
  return {
    screenshot: {
      data: "same-screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

function holdUp(
  toolCallId: string
): Extract<AgentEvent, { type: "tool-call" }> {
  return {
    input: { button: "Up", duration: 12 },
    toolCallId,
    toolName: "mgba_hold",
    type: "tool-call",
  };
}

describe("RunMetricsTracker", () => {
  it("tracks action repetition, observation discipline, screen novelty, and latency", () => {
    const tracker = new RunMetricsTracker({
      experimentId: "supervisor",
      iteration: 4,
      mode: "exploratory",
      runId: "run-4",
    });
    const events: [AgentEvent, number][] = [
      [{ type: "turn-start" }, 0],
      [{ type: "step-start" }, 5],
      [
        {
          input: {},
          toolCallId: "shot-1",
          toolName: "mgba_screenshot",
          type: "tool-call",
        },
        10,
      ],
      [
        {
          output: { data: "screen-a" },
          toolCallId: "shot-1",
          toolName: "mgba_screenshot",
          type: "tool-result",
        },
        20,
      ],
      [
        {
          input: { button: "A" },
          toolCallId: "tap-1",
          toolName: "mgba_tap",
          type: "tool-call",
        },
        30,
      ],
      [
        {
          output: { ok: true },
          toolCallId: "tap-1",
          toolName: "mgba_tap",
          type: "tool-result",
        },
        40,
      ],
      [{ type: "step-end" }, 50],
      [{ type: "turn-end" }, 100],
      [{ type: "turn-start" }, 200],
      [
        {
          input: { button: "A" },
          toolCallId: "tap-2",
          toolName: "mgba_tap",
          type: "tool-call",
        },
        210,
      ],
      [
        {
          output: { ok: false },
          toolCallId: "tap-2",
          toolName: "mgba_tap",
          type: "tool-result",
        },
        225,
      ],
      [{ type: "turn-end" }, 260],
    ];

    for (const [event, now] of events) {
      tracker.recordEvent(event, now);
    }

    expect(tracker.snapshot()).toMatchObject({
      aButtonControlCalls: 2,
      controlToolCalls: 2,
      failedToolCalls: 1,
      lastToolDurationMs: 15,
      lastTurnDurationMs: 60,
      maxSameActionStreak: 2,
      observeBeforeActRatio: 0.5,
      sameActionStreak: 2,
      screenshotCalls: 1,
      toolCalls: 3,
      toolErrorRate: 1 / 3,
      supervisorInterventions: 0,
      uniqueActionCount: 1,
      uniqueScreenCount: 1,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_control_a_button_ratio{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_same_action_streak{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor",category="max",kind="max"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_tool_calls_total{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor",category="failed",kind="failed"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_supervisor_interventions_total{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor"} 0'
    );
  });

  it("counts supervisor interventions from events and direct records", () => {
    const tracker = new RunMetricsTracker({ runId: "run-supervised" });

    tracker.recordEvent({
      intervention: {
        detail: "waited through black frame",
        reason: "black-frame-wait",
      },
      type: "supervisor-intervention",
    });
    tracker.recordSupervisorIntervention("long-movement-split");

    expect(tracker.snapshot().supervisorInterventions).toBe(2);
    expect(tracker.prometheusMetrics()).toContain(
      'pss_mgba_supervisor_interventions_total{run_id="run-supervised",iteration="0"} 2'
    );
  });

  it("tracks stuck events in Prometheus metrics", () => {
    const tracker = new RunMetricsTracker({ runId: "run-stuck" });

    tracker.recordStuckEvents(1);

    expect(tracker.snapshot().stuckEvents).toBe(1);
    expect(tracker.prometheusMetrics()).toContain(
      'pss_mgba_stuck_events_total{run_id="run-stuck",iteration="0"} 1'
    );
  });
});

describe("StuckMemory", () => {
  it("detects repeated failed movement exactly on the 8th stationary overworld attempt", () => {
    const memory = new StuckMemory();

    for (let turn = 1; turn <= 7; turn += 1) {
      memory.recordEvent(holdUp(`hold-${turn}`), observation(), turn);
      memory.observe(observation(), turn + 1);

      expect(memory.snapshot().stuckEvents).toBe(0);
    }

    memory.recordEvent(holdUp("hold-8"), observation(), 8);
    memory.observe(observation(), 9);

    expect(memory.snapshot()).toMatchObject({
      failedMovementEdges: [
        {
          action: "hold:Up",
          attempts: 8,
          context: "map=12 x=10 y=14 facing=up",
          lastSeenTurn: 9,
        },
      ],
      stuckEvents: 1,
    });
  });

  it("does not mark battle, dialogue, menu, title-like, or unavailable contexts as stuck", () => {
    const contexts: (PokemonStateObservation | undefined)[] = [
      { ...baseState, battle: true },
      { ...baseState, dialogueLike: true },
      { ...baseState, menuLike: true },
      { ...baseState, mapId: null },
      { ...baseState, readStatus: "unavailable" },
    ];

    for (const state of contexts) {
      const memory = new StuckMemory();
      for (let turn = 1; turn <= 8; turn += 1) {
        memory.recordEvent(holdUp(`hold-${turn}`), observation(state), turn);
        memory.observe(observation(state), turn + 1);
      }

      expect(memory.snapshot().stuckEvents).toBe(0);
      expect(memory.snapshot().failedMovementEdges).toEqual([]);
    }
  });
});
