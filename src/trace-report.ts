import { readRunSummaries } from "./run-summary";

const runs = await readRunSummaries();
if (runs.length === 0) {
  console.log("No pss-mgba run traces found.");
} else {
  console.table(
    runs.map((run) => ({
      iteration: run.iteration,
      runId: run.runId,
      mode: run.mode ?? "",
      experimentId: run.experimentId ?? "",
      milestoneCurrent: run.milestoneCurrent ?? "",
      milestoneFurthest: run.milestoneFurthest ?? "",
      turns: run.turns,
      totalTokens: run.totalTokens.totalTokens,
      avgTokensPerTurn: run.avgTokensPerTurn.toFixed(1),
      avgTokensSavedVsPrevious: run.avgTokensSavedVsPrevious.toFixed(1),
      improvementPercentVsPrevious:
        run.avgTokensImprovementPercentVsPrevious.toFixed(1),
    }))
  );
}
