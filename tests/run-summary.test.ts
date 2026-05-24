import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRunSummaries,
  renderRunSummaryPrometheus,
} from "../src/run-summary";

async function writeRun(
  runsDir: string,
  runId: string,
  iteration: number,
  totals: number[],
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const runDir = join(runsDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({ iteration, runId, ...metadata })
  );
  await writeFile(
    join(runDir, "token-usage.jsonl"),
    totals
      .map((total, index) =>
        JSON.stringify({
          iteration,
          runId,
          schemaVersion: 1,
          steps: 1,
          timestamp: new Date(index).toISOString(),
          turn: index + 1,
          type: "turn-summary",
          usage: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            inputTokens: total,
            noCacheTokens: total,
            outputTokens: 0,
            reasoningTokens: 0,
            textTokens: 0,
            totalTokens: total,
          },
        })
      )
      .join("\n")
  );
}

describe("run summary metrics", () => {
  it("computes per-run efficiency and improvement versus previous run", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-summary-"));
    const runsDir = join(root, "runs");
    await writeRun(runsDir, "run-1", 1, [100, 100]);
    await writeRun(runsDir, "run-2", 2, [60, 60]);

    const summaries = await readRunSummaries(runsDir);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      avgTokensPerTurn: 100,
      avgTokensSavedVsPrevious: 0,
      turns: 2,
    });
    expect(summaries[1]).toMatchObject({
      avgTokensImprovementPercentVsPrevious: 40,
      avgTokensPerTurn: 60,
      avgTokensSavedVsPrevious: 40,
      totalTokensSavedVsPrevious: 80,
      turns: 2,
    });

    const prometheus = renderRunSummaryPrometheus(summaries);
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="run-2",iteration="2"} 60'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_improvement_percent_vs_previous{run_id="run-2",iteration="2"} 40'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_summary_tokens{run_id="run-2",iteration="2",kind="total"} 120'
    );
  });

  it("preserves experiment metadata and labels recovery runs distinctly", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-summary-metadata-"));
    const runsDir = join(root, "runs");
    await writeRun(runsDir, "fresh-run", 1, [100], {
      experimentId: "state-observation",
      mode: "fresh",
      stateSource: "new-game",
    });
    await writeRun(runsDir, "recovery-run", 2, [75], {
      experimentId: "retry-recovery",
      milestoneCurrent: "player-control-reached",
      milestoneFurthest: "first-map-transition",
      mode: "recovery",
      saveStatePath: ".pss-mgba/states/retry.ss0",
      stateSource: "save-state",
    });

    const summaries = await readRunSummaries(runsDir);

    expect(summaries[0]).toMatchObject({
      experimentId: "state-observation",
      mode: "fresh",
      stateSource: "new-game",
    });
    expect(summaries[1]).toMatchObject({
      experimentId: "retry-recovery",
      milestoneCurrent: "player-control-reached",
      milestoneFurthest: "first-map-transition",
      mode: "recovery",
      saveStatePath: ".pss-mgba/states/retry.ss0",
      stateSource: "save-state",
    });

    const prometheus = renderRunSummaryPrometheus(summaries);
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation"} 100'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="recovery-run",iteration="2",mode="recovery",experiment_id="retry-recovery"} 75'
    );
  });
});
