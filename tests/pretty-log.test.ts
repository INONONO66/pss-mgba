import { describe, expect, it } from "vitest";
import {
  createPrettyLogger,
  renderAgentEvent,
  renderRunTrace,
  renderTokenUsageMetric,
} from "../src/pretty-log";

describe("pretty log rendering", () => {
  it("renders compact tool calls and status results", () => {
    expect(
      renderAgentEvent({
        input: { button: "Start" },
        toolCallId: "call_kJQOuFtbBukhgYS3Rw71yu10",
        toolName: "mgba_tap",
        type: "tool-call",
      })
    ).toBe("🛠 call mgba_tap #call_kJQ · button=Start");

    expect(
      renderAgentEvent({
        output: {
          type: "json",
          value: {
            activeButtons: [],
            frame: 2817,
            gameCode: "DMG-AR",
            gameTitle: "PKMN RED ST",
          },
        },
        toolCallId: "call_jUzEurH0kh7gvGGJAGYg9PSE",
        toolName: "mgba_status",
        type: "tool-result",
      })
    ).toBe(
      "🎮 result mgba_status #call_jUz · frame 2,817 · PKMN RED ST DMG-AR · buttons none"
    );
  });

  it("renders token usage and run trace summaries", () => {
    expect(
      renderRunTrace({
        iteration: 1,
        metricsDir: ".pss-mgba/traces/runs/00001",
        runId: "00001-2026-05-23T17-52-38-490Z",
        startedAt: "2026-05-23T17:52:38.490Z",
      })
    ).toBe(
      "🏁 run 00001-2026-05-23T17-52-38-490Z · iteration 1 · metrics .pss-mgba/traces/runs/00001"
    );

    expect(
      renderTokenUsageMetric({
        iteration: 1,
        modelId: "openai-compatible.chat:gpt-5.3-codex-spark",
        runId: "run-1",
        schemaVersion: 1,
        step: 15,
        timestamp: "2026-05-23T17:53:28.158Z",
        turn: 1,
        type: "llm-step",
        usage: {
          cacheReadTokens: 19_456,
          cacheWriteTokens: 0,
          inputTokens: 23_198,
          noCacheTokens: 3742,
          outputTokens: 1843,
          reasoningTokens: 1826,
          textTokens: 17,
          totalTokens: 25_041,
        },
      })
    ).toBe(
      "🤖 step 15 · turn 1 · openai-compatible.chat:gpt-5.3-codex-spark · tokens 25,041 (in 23,198 / out 1,843 / reasoning 1,826)"
    );
  });

  it("can emit ANSI color", () => {
    expect(renderAgentEvent({ type: "step-start" }, { color: true })).toContain(
      "\u001b[2m•\u001b[0m"
    );
  });

  it("writes through the logger facade", () => {
    const lines: string[] = [];
    const logger = createPrettyLogger({
      color: false,
      write: (line) => lines.push(line),
    });

    logger.event({ text: "hello", type: "assistant-text" });

    expect(lines).toEqual(["💬 assistant · hello"]);
  });
});
