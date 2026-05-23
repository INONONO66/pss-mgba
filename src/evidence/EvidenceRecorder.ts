import { appendFile, mkdir, writeFile } from "node:fs/promises";
import type { HarnessStatus } from "../types.js";
import { buildRunPaths, type RunPaths } from "./RunPaths.js";

export interface EvidenceRecorderOptions {
  readonly evidenceDir?: string;
  readonly runId?: string;
  readonly now?: () => Date;
}

export interface ScreenshotMetadata {
  readonly path: string;
  readonly frame?: number;
  readonly step?: number;
  readonly note?: string;
}

interface EvidenceEvent {
  readonly type: string;
  readonly sequence?: number;
  readonly timestamp: string;
  readonly payload: unknown;
}

interface RunSummary {
  readonly runId: string;
  readonly status: HarnessStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly counts: {
    readonly states: number;
    readonly decisions: number;
    readonly actions: number;
    readonly screenshots: number;
    readonly errors: number;
    readonly events: number;
  };
  readonly result?: unknown;
}

const secretKeyPattern = /(api[_-]?key|token|secret|password|authorization|credential)/i;
const secretValuePattern = /\b(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*[:=][A-Za-z0-9._-]+)\b/g;

export class EvidenceRecorder {
  readonly paths: RunPaths;

  private readonly now: () => Date;
  private startedAt: string | undefined;
  private stateCount = 0;
  private decisionCount = 0;
  private actionCount = 0;
  private screenshotCount = 0;
  private errorCount = 0;
  private eventCount = 0;

  constructor(options: EvidenceRecorderOptions = {}) {
    const runId = options.runId ?? createRunId(options.now?.() ?? new Date());
    this.paths = buildRunPaths(options.evidenceDir ?? "runs", runId);
    this.now = options.now ?? (() => new Date());
  }

  async startRun(config: unknown): Promise<void> {
    this.startedAt = this.timestamp();
    await this.ensureDirectories();
    await writeJson(this.paths.configFile, redactSecrets(config));
    await writeFile(this.paths.eventsFile, "", "utf8");
    await this.appendEvent("run_started", { config });
  }

  async recordState(state: unknown): Promise<string> {
    const sequence = ++this.stateCount;
    const file = this.paths.stateFile(sequence);
    await writeJson(file, redactSecrets(state));
    await this.appendEvent("state", { file, state }, sequence);
    return file;
  }

  async recordDecision(decision: unknown): Promise<void> {
    const sequence = ++this.decisionCount;
    await this.appendEvent("decision", decision, sequence);
  }

  async recordAction(action: unknown): Promise<void> {
    const sequence = ++this.actionCount;
    await this.appendEvent("action", action, sequence);
  }

  async recordScreenshot(metadata: ScreenshotMetadata): Promise<string> {
    const sequence = ++this.screenshotCount;
    const file = this.paths.screenshotFile(sequence);
    await writeJson(file, redactSecrets(metadata));
    await this.appendEvent("screenshot", { file, metadata }, sequence);
    return file;
  }

  async recordError(error: unknown): Promise<string> {
    const sequence = ++this.errorCount;
    const file = this.paths.errorFile(sequence);
    const payload = normalizeError(error);
    await writeJson(file, redactSecrets(payload));
    await this.appendEvent("error", { file, error: payload }, sequence);
    return file;
  }

  async finishRun(status: HarnessStatus, result?: unknown): Promise<RunSummary> {
    const summary: RunSummary = {
      runId: this.paths.runId,
      status,
      startedAt: this.startedAt ?? this.timestamp(),
      finishedAt: this.timestamp(),
      counts: {
        states: this.stateCount,
        decisions: this.decisionCount,
        actions: this.actionCount,
        screenshots: this.screenshotCount,
        errors: this.errorCount,
        events: this.eventCount + 1
      },
      result: redactSecrets(result)
    };

    await writeJson(this.paths.summaryFile, summary);
    await this.appendEvent("run_finished", summary);
    return summary;
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.statesDir, { recursive: true }),
      mkdir(this.paths.screenshotsDir, { recursive: true }),
      mkdir(this.paths.rawScreenshotsDir, { recursive: true }),
      mkdir(this.paths.visionDir, { recursive: true }),
      mkdir(this.paths.errorsDir, { recursive: true })
    ]);
  }

  private async appendEvent(type: string, payload: unknown, sequence?: number): Promise<void> {
    const event: EvidenceEvent = {
      type,
      sequence,
      timestamp: this.timestamp(),
      payload: redactSecrets(payload)
    };
    this.eventCount += 1;
    await appendFile(this.paths.eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function createRunId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(secretValuePattern, "[REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : redactSecrets(entry)
      ])
    );
  }

  return value;
}

function normalizeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return error;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
