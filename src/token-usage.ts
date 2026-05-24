import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentModel } from "@minpeter/pss-runtime";
import {
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  wrapLanguageModel,
} from "ai";

export interface TokenUsageTrackerOptions {
  iteration?: number;
  metricsDir?: string;
  onMetric?: (metric: TokenUsageMetric) => void;
  prometheusPath?: string;
  runId?: string;
}

export interface TokenUsageSnapshot {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  noCacheTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  textTokens: number;
  totalTokens: number;
}

export type TokenUsageMetric =
  | {
      iteration: number;
      modelId: string;
      runId: string;
      schemaVersion: 1;
      step: number;
      timestamp: string;
      turn: number;
      type: "llm-step";
      usage: TokenUsageSnapshot;
    }
  | {
      iteration: number;
      runId: string;
      schemaVersion: 1;
      steps: number;
      timestamp: string;
      turn: number;
      type: "turn-summary";
      usage: TokenUsageSnapshot;
    };

interface CreateTrackedModelOptions {
  model: AgentModel;
  tracker: TokenUsageTracker;
}

interface ProviderUsage {
  inputTokens: {
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
    noCache: number | undefined;
    total: number | undefined;
  };
  outputTokens: {
    reasoning: number | undefined;
    text: number | undefined;
    total: number | undefined;
  };
}

const DEFAULT_METRICS_DIR = ".pss-mgba/metrics";

export class TokenUsageTracker {
  readonly #jsonlPath: string;
  readonly #onMetric?: (metric: TokenUsageMetric) => void;
  readonly #prometheusPath: string;
  readonly #runId: string;
  readonly #iteration: number;
  #currentStep = 0;
  #currentTurn = 0;
  #totalUsage = emptyUsage();
  #turnUsage = emptyUsage();

  constructor({
    iteration = 0,
    metricsDir = DEFAULT_METRICS_DIR,
    onMetric,
    prometheusPath = join(DEFAULT_METRICS_DIR, "token-usage.prom"),
    runId = "unknown",
  }: TokenUsageTrackerOptions = {}) {
    this.#jsonlPath = join(metricsDir, "token-usage.jsonl");
    this.#prometheusPath = prometheusPath;
    this.#onMetric = onMetric;
    this.#runId = runId;
    this.#iteration = iteration;
  }

  startTurn(turn: number): void {
    this.#currentTurn = turn;
    this.#currentStep = 0;
    this.#turnUsage = emptyUsage();
  }

  async recordLlmStep(
    usage: LanguageModelUsage,
    { modelId }: { modelId: string }
  ): Promise<void> {
    await this.recordUsageSnapshot(normalizeUsage(usage), { modelId });
  }

  async recordProviderUsage(
    usage: ProviderUsage,
    { modelId }: { modelId: string }
  ): Promise<void> {
    await this.recordUsageSnapshot(normalizeProviderUsage(usage), { modelId });
  }

  async recordUsageSnapshot(
    snapshot: TokenUsageSnapshot,
    { modelId }: { modelId: string }
  ): Promise<void> {
    this.#currentStep += 1;
    this.#turnUsage = addUsage(this.#turnUsage, snapshot);
    this.#totalUsage = addUsage(this.#totalUsage, snapshot);

    await this.#writeMetric({
      iteration: this.#iteration,
      modelId,
      runId: this.#runId,
      schemaVersion: 1,
      step: this.#currentStep,
      timestamp: new Date().toISOString(),
      turn: this.#currentTurn,
      type: "llm-step",
      usage: snapshot,
    });
  }

  async endTurn(): Promise<void> {
    await this.#writeMetric({
      iteration: this.#iteration,
      runId: this.#runId,
      schemaVersion: 1,
      steps: this.#currentStep,
      timestamp: new Date().toISOString(),
      turn: this.#currentTurn,
      type: "turn-summary",
      usage: this.#turnUsage,
    });
  }

  prometheusMetrics(): string {
    return renderPrometheus(this.snapshot());
  }

  snapshot(): {
    iteration: number;
    runId: string;
    step: number;
    totalUsage: TokenUsageSnapshot;
    turn: number;
    turnUsage: TokenUsageSnapshot;
  } {
    return {
      iteration: this.#iteration,
      runId: this.#runId,
      step: this.#currentStep,
      totalUsage: this.#totalUsage,
      turn: this.#currentTurn,
      turnUsage: this.#turnUsage,
    };
  }

  async #writeMetric(metric: TokenUsageMetric): Promise<void> {
    this.#onMetric?.(metric);
    await Promise.all([
      mkdir(dirname(this.#jsonlPath), { recursive: true }),
      mkdir(dirname(this.#prometheusPath), { recursive: true }),
    ]);
    await appendFile(this.#jsonlPath, `${JSON.stringify(metric)}\n`);
    await writeFile(this.#prometheusPath, this.prometheusMetrics());
  }
}

export function createTrackedModel({
  model,
  tracker,
}: CreateTrackedModelOptions): AgentModel {
  return wrapLanguageModel({
    model: model as never,
    middleware: createTokenUsageMiddleware(tracker),
  }) as AgentModel;
}

function createTokenUsageMiddleware(
  tracker: TokenUsageTracker
): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate();
      await tracker.recordProviderUsage(result.usage, {
        modelId: `${model.provider}:${model.modelId}`,
      });
      return result;
    },
  };
}

function emptyUsage(): TokenUsageSnapshot {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 0,
    noCacheTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    textTokens: 0,
    totalTokens: 0,
  };
}

function normalizeUsage(usage: LanguageModelUsage): TokenUsageSnapshot {
  return {
    cacheReadTokens: tokenCount(usage.inputTokenDetails.cacheReadTokens),
    cacheWriteTokens: tokenCount(usage.inputTokenDetails.cacheWriteTokens),
    inputTokens: tokenCount(usage.inputTokens),
    noCacheTokens: tokenCount(usage.inputTokenDetails.noCacheTokens),
    outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: tokenCount(usage.outputTokenDetails.reasoningTokens),
    textTokens: tokenCount(usage.outputTokenDetails.textTokens),
    totalTokens: tokenCount(usage.totalTokens),
  };
}

function normalizeProviderUsage(usage: ProviderUsage): TokenUsageSnapshot {
  return {
    cacheReadTokens: tokenCount(usage.inputTokens.cacheRead),
    cacheWriteTokens: tokenCount(usage.inputTokens.cacheWrite),
    inputTokens: tokenCount(usage.inputTokens.total),
    noCacheTokens: tokenCount(usage.inputTokens.noCache),
    outputTokens: tokenCount(usage.outputTokens.total),
    reasoningTokens: tokenCount(usage.outputTokens.reasoning),
    textTokens: tokenCount(usage.outputTokens.text),
    totalTokens:
      tokenCount(usage.inputTokens.total) +
      tokenCount(usage.outputTokens.total),
  };
}

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addUsage(
  left: TokenUsageSnapshot,
  right: TokenUsageSnapshot
): TokenUsageSnapshot {
  return {
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    noCacheTokens: left.noCacheTokens + right.noCacheTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    textTokens: left.textTokens + right.textTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function renderPrometheus({
  iteration,
  runId,
  step,
  totalUsage,
  turn,
  turnUsage,
}: ReturnType<TokenUsageTracker["snapshot"]>): string {
  return [
    "# HELP pss_mgba_run_iteration Current run iteration number.",
    "# TYPE pss_mgba_run_iteration gauge",
    `pss_mgba_run_iteration${labels({ iteration, runId })} ${iteration}`,
    "# HELP pss_mgba_turn_current Current autonomous loop turn.",
    "# TYPE pss_mgba_turn_current gauge",
    `pss_mgba_turn_current${labels({ iteration, runId })} ${turn}`,
    "# HELP pss_mgba_step_current Current model step within the turn.",
    "# TYPE pss_mgba_step_current gauge",
    `pss_mgba_step_current${labels({ iteration, runId })} ${step}`,
    "# HELP pss_mgba_turn_tokens Tokens used in the current turn by kind.",
    "# TYPE pss_mgba_turn_tokens gauge",
    ...usageLines("pss_mgba_turn_tokens", turnUsage, { iteration, runId }),
    "# HELP pss_mgba_tokens_total Cumulative tokens used by kind.",
    "# TYPE pss_mgba_tokens_total counter",
    ...usageLines("pss_mgba_tokens_total", totalUsage, { iteration, runId }),
    "",
  ].join("\n");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function labels({
  iteration,
  kind,
  runId,
}: {
  iteration: number;
  kind?: string;
  runId: string;
}): string {
  const entries = [
    `run_id="${escapeLabel(runId)}"`,
    `iteration="${iteration}"`,
  ];
  if (kind) {
    entries.push(`kind="${escapeLabel(kind)}"`);
  }
  return `{${entries.join(",")}}`;
}

function usageLines(
  metricName: string,
  usage: TokenUsageSnapshot,
  context: { iteration: number; runId: string }
): string[] {
  return [
    `input ${usage.inputTokens}`,
    `output ${usage.outputTokens}`,
    `total ${usage.totalTokens}`,
    `reasoning ${usage.reasoningTokens}`,
    `text ${usage.textTokens}`,
    `cache_read ${usage.cacheReadTokens}`,
    `cache_write ${usage.cacheWriteTokens}`,
    `no_cache ${usage.noCacheTokens}`,
  ].map((entry) => {
    const [kind, value] = entry.split(" ");
    return `${metricName}${labels({ ...context, kind })} ${value}`;
  });
}
