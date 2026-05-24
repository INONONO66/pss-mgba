import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACE_ROOT = ".pss-mgba/traces";
const ITERATION_COUNTER_PATH = join(TRACE_ROOT, "iteration-counter.json");
const ITERATIONS_JSONL_PATH = join(TRACE_ROOT, "iterations.jsonl");

export const EXPERIMENT_MODES = [
  "fresh",
  "resumed",
  "recovery",
  "deterministic-replay",
  "exploratory",
] as const;

export const SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP =
  "SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP" as const;

export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];
export type SaveStateSupportStatus =
  | "supported"
  | typeof SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP;

export interface RunExperimentMetadata {
  experimentId?: string;
  milestone?: string;
  milestoneCurrent?: string;
  milestoneFurthest?: string;
  mode: ExperimentMode;
  objective?: string;
  ramReadStatus?: string;
  runBudget?: string;
  saveStatePath?: string;
  saveStateStatus?: SaveStateSupportStatus;
  stateSource?: string;
  stuckEvents?: number;
  supervisorEnabled?: boolean;
  supervisorInterventions?: number;
}

export interface RunTrace extends Partial<RunExperimentMetadata> {
  iteration: number;
  metricsDir: string;
  runId: string;
  startedAt: string;
}

export const OPTIMIZED_FRESH_RUN_METADATA = {
  experimentId: "combined-optimized",
  mode: "fresh",
  objective:
    "Continue playing the already-loaded Pokemon game autonomously without reset, reload, or restart.",
  runBudget: "300s",
  stateSource: "already-running-mgba-http",
  stuckEvents: 0,
  supervisorEnabled: true,
  supervisorInterventions: 0,
} satisfies RunExperimentMetadata;

interface IterationCounter {
  nextIteration: number;
}

export async function createRunTrace(
  now = new Date(),
  metadata?: RunExperimentMetadata
): Promise<RunTrace> {
  await mkdir(TRACE_ROOT, { recursive: true });

  const counter = await readIterationCounter();
  const iteration = counter.nextIteration;
  await writeFile(
    ITERATION_COUNTER_PATH,
    `${JSON.stringify({ nextIteration: iteration + 1 } satisfies IterationCounter)}
`
  );

  const startedAt = now.toISOString();
  const runId = `${iteration.toString().padStart(5, "0")}-${startedAt.replaceAll(/[:.]/g, "-")}`;
  const metricsDir = join(TRACE_ROOT, "runs", runId);
  await mkdir(metricsDir, { recursive: true });

  const trace = {
    iteration,
    metricsDir,
    runId,
    startedAt,
    ...(metadata ? validateRunExperimentMetadata(metadata) : {}),
  } satisfies RunTrace;
  await appendFile(
    ITERATIONS_JSONL_PATH,
    `${JSON.stringify({ schemaVersion: 2, type: "run-start", ...trace })}
`
  );
  await writeFile(
    join(metricsDir, "run.json"),
    `${JSON.stringify(trace, null, 2)}
`
  );

  return trace;
}

export async function createOptimizedFreshRunTrace(
  now = new Date()
): Promise<RunTrace> {
  return await createRunTrace(now, OPTIMIZED_FRESH_RUN_METADATA);
}

export async function updateRunTraceMetadata(
  trace: RunTrace,
  metadata: Partial<RunExperimentMetadata>
): Promise<RunTrace> {
  const next = {
    ...trace,
    ...metadata,
  } satisfies RunTrace;
  await writeFile(
    join(trace.metricsDir, "run.json"),
    `${JSON.stringify(next, null, 2)}
`
  );
  return next;
}

export function validateRunExperimentMetadata(
  metadata: RunExperimentMetadata
): RunExperimentMetadata {
  if (!EXPERIMENT_MODES.includes(metadata.mode)) {
    throw new Error(`Invalid experiment mode: ${String(metadata.mode)}`);
  }
  if (
    metadata.saveStateStatus === "supported" &&
    (metadata.mode === "recovery" ||
      metadata.mode === "deterministic-replay") &&
    !metadata.saveStatePath
  ) {
    throw new Error(
      `saveStatePath is required for ${metadata.mode} when save-state support is available`
    );
  }
  if (
    metadata.saveStateStatus === SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP &&
    metadata.saveStatePath
  ) {
    throw new Error(
      "saveStatePath must be omitted when save-state is unsupported by current mGBA-http"
    );
  }
  return metadata;
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
