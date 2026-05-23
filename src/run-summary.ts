import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TokenUsageMetric, TokenUsageSnapshot } from "./token-usage";

export const DEFAULT_RUNS_DIR = ".pss-mgba/traces/runs";

export interface RunSummary {
  avgTokensImprovementPercentVsPrevious: number;
  avgTokensPerTurn: number;
  avgTokensSavedVsPrevious: number;
  iteration: number;
  runId: string;
  totalTokens: TokenUsageSnapshot;
  totalTokensSavedVsPrevious: number;
  turns: number;
}

interface RawRunSummary {
  avgTokensPerTurn: number;
  iteration: number;
  runId: string;
  totalTokens: TokenUsageSnapshot;
  turns: number;
}

export async function readRunSummaries(
  runsDir = DEFAULT_RUNS_DIR
): Promise<RunSummary[]> {
  let runIds: string[];
  try {
    runIds = await readdir(runsDir);
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(
    runIds.map(async (runId) => readRawRunSummary(runsDir, runId))
  );
  const sorted = summaries
    .filter((summary): summary is RawRunSummary => Boolean(summary))
    .sort((left, right) => left.iteration - right.iteration);

  return sorted.map((summary, index) => {
    const previous = sorted[index - 1];
    const avgTokensSavedVsPrevious = previous
      ? previous.avgTokensPerTurn - summary.avgTokensPerTurn
      : 0;
    return {
      ...summary,
      avgTokensImprovementPercentVsPrevious:
        previous && previous.avgTokensPerTurn > 0
          ? (avgTokensSavedVsPrevious / previous.avgTokensPerTurn) * 100
          : 0,
      avgTokensSavedVsPrevious,
      totalTokensSavedVsPrevious: previous
        ? previous.totalTokens.totalTokens - summary.totalTokens.totalTokens
        : 0,
    };
  });
}

export function renderRunSummaryPrometheus(
  summaries: readonly RunSummary[]
): string {
  if (summaries.length === 0) {
    return "";
  }

  return [
    "# HELP pss_mgba_run_summary_turns Completed turns recorded for a run iteration.",
    "# TYPE pss_mgba_run_summary_turns gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_summary_turns${labels(summary)} ${summary.turns}`
    ),
    "# HELP pss_mgba_run_summary_tokens Total tokens recorded for a completed or current run by kind.",
    "# TYPE pss_mgba_run_summary_tokens gauge",
    ...summaries.flatMap((summary) => usageLines(summary)),
    "# HELP pss_mgba_run_avg_tokens_per_turn Average total tokens per turn for a run iteration.",
    "# TYPE pss_mgba_run_avg_tokens_per_turn gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_per_turn${labels(summary)} ${summary.avgTokensPerTurn}`
    ),
    "# HELP pss_mgba_run_avg_tokens_saved_vs_previous Average tokens per turn saved versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_avg_tokens_saved_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_saved_vs_previous${labels(summary)} ${summary.avgTokensSavedVsPrevious}`
    ),
    "# HELP pss_mgba_run_avg_tokens_improvement_percent_vs_previous Percent improvement in average tokens per turn versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_avg_tokens_improvement_percent_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_improvement_percent_vs_previous${labels(summary)} ${summary.avgTokensImprovementPercentVsPrevious}`
    ),
    "# HELP pss_mgba_run_total_tokens_saved_vs_previous Total tokens saved versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_total_tokens_saved_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_total_tokens_saved_vs_previous${labels(summary)} ${summary.totalTokensSavedVsPrevious}`
    ),
    "",
  ].join("\n");
}

async function readRawRunSummary(
  runsDir: string,
  runId: string
): Promise<RawRunSummary | null> {
  const run = JSON.parse(
    await readFile(join(runsDir, runId, "run.json"), "utf8")
  ) as { iteration: number; runId: string };
  const usageJsonl = await readFile(
    join(runsDir, runId, "token-usage.jsonl"),
    "utf8"
  ).catch((error: unknown) => {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  });

  const turnSummaries = usageJsonl
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TokenUsageMetric)
    .filter((metric) => metric.type === "turn-summary");

  if (turnSummaries.length === 0) {
    return {
      avgTokensPerTurn: 0,
      iteration: run.iteration,
      runId: run.runId,
      totalTokens: emptyUsage(),
      turns: 0,
    };
  }

  const totalTokens = turnSummaries.reduce(
    (accumulator, metric) => addUsage(accumulator, metric.usage),
    emptyUsage()
  );

  return {
    avgTokensPerTurn: totalTokens.totalTokens / turnSummaries.length,
    iteration: run.iteration,
    runId: run.runId,
    totalTokens,
    turns: turnSummaries.length,
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

function usageLines(summary: RunSummary): string[] {
  const usage = summary.totalTokens;
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
    return `pss_mgba_run_summary_tokens${labels(summary, kind)} ${value}`;
  });
}

function labels(summary: RunSummary, kind?: string): string {
  const entries = [
    `run_id="${escapeLabel(summary.runId)}"`,
    `iteration="${summary.iteration}"`,
  ];
  if (kind) {
    entries.push(`kind="${escapeLabel(kind)}"`);
  }
  return `{${entries.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}
