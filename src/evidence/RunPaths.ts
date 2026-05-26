import path from "node:path";

export interface RunPaths {
  readonly rootDir: string;
  readonly runId: string;
  readonly runDir: string;
  readonly configFile: string;
  readonly summaryFile: string;
  readonly globalDir: string;
  readonly turnsDir: string;
  readonly rawScreenshotsDir: string;
  readonly visionDir: string;
  readonly errorsDir: string;
  readonly mapMemoryFile: string;
  readonly agentMemoryFile: string;
  turnFile(sequence: number): string;
  errorFile(sequence: number): string;
}

export function buildRunPaths(rootDir: string, runId: string): RunPaths {
  assertSafeRunId(runId);
  const runDir = path.join(rootDir, runId);
  assertRunDirInsideRoot(rootDir, runDir);
  const globalDir = path.join(runDir, "global");
  const turnsDir = path.join(runDir, "turns");
  const rawScreenshotsDir = path.join(runDir, "raw-screenshots");
  const visionDir = path.join(runDir, "vision");
  const errorsDir = path.join(runDir, "errors");

  return {
    rootDir,
    runId,
    runDir,
    configFile: path.join(runDir, "config.json"),
    summaryFile: path.join(globalDir, "run-summary.json"),
    globalDir,
    turnsDir,
    rawScreenshotsDir,
    visionDir,
    errorsDir,
    mapMemoryFile: path.join(globalDir, "map-memory.json"),
    agentMemoryFile: path.join(globalDir, "agent-memory.json"),
    turnFile: (sequence: number) => path.join(turnsDir, `${formatSequence(sequence)}.json`),
    errorFile: (sequence: number) => path.join(errorsDir, `${formatSequence(sequence)}.json`)
  };
}


export function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new Error(`Run id must be a safe single path segment: ${runId}`);
  }
}

function assertRunDirInsideRoot(rootDir: string, runDir: string): void {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedRun = path.resolve(runDir);
  const relative = path.relative(resolvedRoot, resolvedRun);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Run directory must stay inside evidence root: ${runDir}`);
  }
}

export function formatSequence(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Evidence sequence must be a positive integer: ${sequence}`);
  }

  return sequence.toString().padStart(6, "0");
}
