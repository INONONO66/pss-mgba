import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACE_ROOT = ".pss-mgba/traces";
const ITERATION_COUNTER_PATH = join(TRACE_ROOT, "iteration-counter.json");
const ITERATIONS_JSONL_PATH = join(TRACE_ROOT, "iterations.jsonl");

export interface RunTrace {
  iteration: number;
  metricsDir: string;
  runId: string;
  startedAt: string;
}

interface IterationCounter {
  nextIteration: number;
}

export async function createRunTrace(now = new Date()): Promise<RunTrace> {
  await mkdir(TRACE_ROOT, { recursive: true });

  const counter = await readIterationCounter();
  const iteration = counter.nextIteration;
  await writeFile(
    ITERATION_COUNTER_PATH,
    `${JSON.stringify({ nextIteration: iteration + 1 } satisfies IterationCounter)}\n`
  );

  const startedAt = now.toISOString();
  const runId = `${iteration.toString().padStart(5, "0")}-${startedAt.replaceAll(/[:.]/g, "-")}`;
  const metricsDir = join(TRACE_ROOT, "runs", runId);
  await mkdir(metricsDir, { recursive: true });

  const trace = { iteration, metricsDir, runId, startedAt } satisfies RunTrace;
  await appendFile(
    ITERATIONS_JSONL_PATH,
    `${JSON.stringify({ schemaVersion: 1, type: "run-start", ...trace })}\n`
  );
  await writeFile(
    join(metricsDir, "run.json"),
    `${JSON.stringify(trace, null, 2)}\n`
  );

  return trace;
}

async function readIterationCounter(): Promise<IterationCounter> {
  try {
    const raw = await readFile(ITERATION_COUNTER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<IterationCounter>;
    if (
      typeof parsed.nextIteration === "number" &&
      Number.isInteger(parsed.nextIteration) &&
      parsed.nextIteration > 0
    ) {
      return { nextIteration: parsed.nextIteration };
    }
  } catch (error) {
    if (!(error instanceof Error && hasCode(error, "ENOENT"))) {
      throw error;
    }
  }

  return { nextIteration: 1 };
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}
