import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import { TokenUsageTracker } from "../src/token-usage";

function usage(partial: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokenDetails: {
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      noCacheTokens: undefined,
    },
    inputTokens: undefined,
    outputTokenDetails: {
      reasoningTokens: undefined,
      textTokens: undefined,
    },
    outputTokens: undefined,
    totalTokens: undefined,
    ...partial,
  };
}

describe("TokenUsageTracker", () => {
  it("writes per-step JSONL and Prometheus token metrics", async () => {
    const metricsDir = await mkdtemp(join(tmpdir(), "pss-mgba-metrics-"));
    const observed: unknown[] = [];
    const tracker = new TokenUsageTracker({
      iteration: 9,
      metricsDir,
      onMetric: (metric) => observed.push(metric),
      prometheusPath: join(metricsDir, "token-usage.prom"),
      runId: "run-9",
    });

    tracker.startTurn(3);
    await tracker.recordLlmStep(
      usage({
        inputTokens: 10,
        outputTokenDetails: { reasoningTokens: 2, textTokens: 5 },
        outputTokens: 7,
        totalTokens: 17,
      }),
      { modelId: "provider:model" }
    );
    await tracker.endTurn();

    const jsonl = await readFile(join(metricsDir, "token-usage.jsonl"), "utf8");
    expect(jsonl.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(jsonl.trim().split("\n")[0] ?? "{}")).toMatchObject({
      iteration: 9,
      modelId: "provider:model",
      runId: "run-9",
      step: 1,
      turn: 3,
      type: "llm-step",
      usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
    });
    expect(observed).toHaveLength(2);

    const prometheus = await readFile(
      join(metricsDir, "token-usage.prom"),
      "utf8"
    );
    expect(prometheus).toContain(
      'pss_mgba_run_iteration{run_id="run-9",iteration="9"} 9'
    );
    expect(prometheus).toContain(
      'pss_mgba_turn_current{run_id="run-9",iteration="9"} 3'
    );
    expect(prometheus).toContain(
      'pss_mgba_tokens_total{run_id="run-9",iteration="9",kind="total"} 17'
    );
    expect(prometheus).toContain(
      'pss_mgba_turn_tokens{run_id="run-9",iteration="9",kind="reasoning"} 2'
    );
  });
});
