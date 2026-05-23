import path from "node:path";

export interface RunPaths {
  readonly rootDir: string;
  readonly runId: string;
  readonly runDir: string;
  readonly configFile: string;
  readonly eventsFile: string;
  readonly summaryFile: string;
  readonly statesDir: string;
  readonly screenshotsDir: string;
  readonly rawScreenshotsDir: string;
  readonly visionDir: string;
  readonly errorsDir: string;
  stateFile(sequence: number): string;
  screenshotFile(sequence: number): string;
  errorFile(sequence: number): string;
}

export function buildRunPaths(rootDir: string, runId: string): RunPaths {
  const runDir = path.join(rootDir, runId);
  const statesDir = path.join(runDir, "states");
  const screenshotsDir = path.join(runDir, "screenshots");
  const rawScreenshotsDir = path.join(runDir, "raw-screenshots");
  const visionDir = path.join(runDir, "vision");
  const errorsDir = path.join(runDir, "errors");

  return {
    rootDir,
    runId,
    runDir,
    configFile: path.join(runDir, "config.json"),
    eventsFile: path.join(runDir, "events.jsonl"),
    summaryFile: path.join(runDir, "summary.json"),
    statesDir,
    screenshotsDir,
    rawScreenshotsDir,
    visionDir,
    errorsDir,
    stateFile: (sequence: number) => path.join(statesDir, `${formatSequence(sequence)}.json`),
    screenshotFile: (sequence: number) => path.join(screenshotsDir, `${formatSequence(sequence)}.json`),
    errorFile: (sequence: number) => path.join(errorsDir, `${formatSequence(sequence)}.json`)
  };
}

export function formatSequence(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Evidence sequence must be a positive integer: ${sequence}`);
  }

  return sequence.toString().padStart(6, "0");
}
