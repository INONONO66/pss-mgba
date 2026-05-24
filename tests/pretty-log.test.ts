import { describe, expect, it } from "vitest";
import {
  createPrettyLogger,
  renderAgentEvent,
  renderObservationInjection,
  renderRunTrace,
  renderTokenUsageMetric,
  renderTotalStep,
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
    ).toBe("ACTION tap button=Start #call_kJQ");

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
        modelId: "openai.responses:gpt-5.3-codex-spark",
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
      "🤖 step 15 · turn 1 · openai.responses:gpt-5.3-codex-spark · tokens 25,041 (in 23,198 / out 1,843 / reasoning 1,826)"
    );
  });

  it("renders blue observation injection markers", () => {
    const injection = {
      nextTurn: 2,
      observation: {
        screenshot: {
          data: "iVBORw0KGgo=",
          mediaType: "image/png" as const,
          path: "/tmp/mgba.png",
        },
        status: {
          activeButtons: [],
          frame: 2817,
          gameCode: "DMG-AR",
          gameTitle: "PKMN RED ST",
        },
      },
    };

    expect(renderObservationInjection(injection)).toBe(
      "INJECT turn 2 · frame 2,817 · [status + screenshot + prompt] injected"
    );
    expect(renderObservationInjection(injection, { color: true })).toContain(
      "\u001b[34mINJECT\u001b[0m"
    );
  });

  it("summarizes injected user messages instead of dumping prompts", () => {
    expect(
      renderAgentEvent({
        content: [
          {
            text: "Turn 8 ended.\n\nCurrent mGBA status:\nframe: 15148\ngame: PKMN RED ST DMG-AR",
            type: "text",
          },
          {
            image: "data:image/png;base64,iVBORw0KGgo=",
            mediaType: "image/png",
            type: "image",
          },
        ],
        type: "user-message",
      })
    ).toBe(
      "INJECT turn prompt · frame 15148 · [status + screenshot + prompt] injected"
    );
  });

  it("makes action tool calls visually obvious", () => {
    expect(
      renderAgentEvent({
        input: { buttons: ["Down"], duration: 18 },
        toolCallId: "call_r4nEXAMPLE",
        toolName: "mgba_hold_many",
        type: "tool-call",
      })
    ).toBe("ACTION hold_many buttons=[Down] · duration=18 #call_r4n");
  });

  it("colors button values red in action lines", () => {
    expect(
      renderAgentEvent(
        {
          input: { buttons: ["Down", "Right"], duration: 18 },
          toolCallId: "call_redBUTTON",
          toolName: "mgba_hold_many",
          type: "tool-call",
        },
        { color: true }
      )
    ).toContain("buttons=\u001b[31m[Down, Right]\u001b[0m");
  });

  it("combines action calls and results into one terminal line", () => {
    const lines: string[] = [];
    const logger = createPrettyLogger({
      color: false,
      write: (line) => lines.push(line),
    });

    logger.event({
      input: { button: "Start" },
      toolCallId: "call_kJQOuFtbBukhgYS3Rw71yu10",
      toolName: "mgba_tap",
      type: "tool-call",
    });
    logger.event({
      output: { type: "json", value: { ok: true, tapped: "Start" } },
      toolCallId: "call_kJQOuFtbBukhgYS3Rw71yu10",
      toolName: "mgba_tap",
      type: "tool-result",
    });

    expect(lines).toEqual([
      "ACTION tap button=Start → DONE ok=true · tapped=Start #call_kJQ\n",
    ]);
  });

  it("suppresses duplicate injected user message after explicit injection log", () => {
    const lines: string[] = [];
    const logger = createPrettyLogger({
      color: false,
      write: (line) => lines.push(line),
    });

    logger.observationInjection({
      nextTurn: 1,
      observation: {
        screenshot: { data: "", mediaType: "image/png", path: "/tmp/shot.png" },
        status: {
          activeButtons: [],
          frame: 38_070,
          gameCode: "DMG-AR",
          gameTitle: "PKMN RED ST",
        },
      },
    });
    logger.event({
      content: [
        {
          text: "Load ROM.\n\nCurrent mGBA status:\nframe: 38070\ngame: PKMN RED ST DMG-AR",
          type: "text",
        },
        {
          image: "data:image/png;base64,iVBORw0KGgo=",
          mediaType: "image/png",
          type: "image",
        },
      ],
      type: "user-message",
    });

    expect(lines).toEqual([
      "INJECT turn 1 · frame 38,070 · [status + screenshot + prompt] injected\n",
    ]);
  });

  it("renders red total step markers every ten step starts", () => {
    expect(renderTotalStep(10)).toBe("[TOTAL STEP: 10]");
    expect(renderTotalStep(1000, { color: true })).toBe(
      "\u001b[31m[TOTAL STEP: 1,000]\u001b[0m"
    );

    const lines: string[] = [];
    const logger = createPrettyLogger({
      color: false,
      write: (line) => lines.push(line),
    });

    for (let index = 0; index < 10; index += 1) {
      logger.event({ type: "step-start" });
    }

    expect(lines).toEqual(["[TOTAL STEP: 10]\n"]);
  });

  it("suppresses turn and step lifecycle noise in the logger facade", () => {
    const lines: string[] = [];
    const logger = createPrettyLogger({
      color: false,
      write: (line) => lines.push(line),
    });

    logger.event({ type: "turn-start" });
    logger.event({ type: "step-start" });
    logger.event({ type: "step-end" });
    logger.event({ type: "turn-end" });

    expect(lines).toEqual([]);
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
    logger.observationInjection({
      nextTurn: 3,
      observation: {
        screenshot: { data: "", mediaType: "image/png", path: "/tmp/shot.png" },
        status: {
          activeButtons: [],
          frame: null,
          gameCode: "",
          gameTitle: "",
        },
      },
    });

    expect(lines).toEqual([
      "💬 assistant · hello\n",
      "INJECT turn 3 · frame unknown · [status + screenshot + prompt] injected\n",
    ]);
  });
});
