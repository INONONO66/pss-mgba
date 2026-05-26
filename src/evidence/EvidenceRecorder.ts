import { mkdir, writeFile } from "node:fs/promises";
import type { HarnessStatus } from "../shared/types.js";
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

interface RunSummary {
  readonly runId: string;
  readonly status: HarnessStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly counts: {
    readonly turns: number;
    readonly screenshots: number;
    readonly errors: number;
  };
  readonly result?: unknown;
}

export interface TurnLog {
  readonly turn: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly frame?: { readonly before?: number; readonly after?: number };
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly reasoning?: string;
  readonly response?: string;
  readonly parsedCommand?: unknown;
  readonly rationale?: string;
  readonly run?: unknown;
  readonly timeline?: readonly unknown[];
  readonly toolCalls?: readonly unknown[];
  readonly gameState?: { readonly before?: unknown; readonly after?: unknown };
  readonly agentMemory?: unknown;
  readonly mapAscii?: string;
  readonly mapGraph?: string;
  readonly detector?: unknown;
  readonly history?: readonly unknown[];
}

const secretKeyPattern = /(api[_-]?key|token|secret|password|authorization|credential)/i;
const secretValuePattern = /\b(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*[:=][A-Za-z0-9._-]+)\b/g;
const inlineImageDataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi;

export class EvidenceRecorder {
  readonly paths: RunPaths;

  private readonly now: () => Date;
  private startedAt: string | undefined;
  private screenshotCount = 0;
  private errorCount = 0;
  private turnCount = 0;

  constructor(options: EvidenceRecorderOptions = {}) {
    const runId = options.runId ?? createRunId(options.now?.() ?? new Date());
    this.paths = buildRunPaths(options.evidenceDir ?? "runs", runId);
    this.now = options.now ?? (() => new Date());
  }

  async startRun(config: unknown): Promise<void> {
    this.startedAt = this.timestamp();
    await this.ensureDirectories();
    await writeJson(this.paths.configFile, redactSecrets(config));
  }

  recordScreenshot(metadata: ScreenshotMetadata): Promise<string> {
    this.screenshotCount += 1;
    return Promise.resolve(metadata.path);
  }

  async recordTurn(turn: TurnLog): Promise<string> {
    const sequence = Math.max(1, Math.trunc(turn.turn));
    this.turnCount = Math.max(this.turnCount, sequence);
    const file = this.paths.turnFile(sequence);
    await writeJson(file, redactSecrets(turn));
    return file;
  }

  async recordError(error: unknown): Promise<string> {
    const sequence = ++this.errorCount;
    const file = this.paths.errorFile(sequence);
    const payload = normalizeError(error);
    await writeJson(file, redactSecrets(payload));
    return file;
  }

  async finishRun(status: HarnessStatus, result?: unknown): Promise<RunSummary> {
    const summary: RunSummary = {
      runId: this.paths.runId,
      status,
      startedAt: this.startedAt ?? this.timestamp(),
      finishedAt: this.timestamp(),
      counts: {
        turns: this.turnCount,
        screenshots: this.screenshotCount,
        errors: this.errorCount,
      },
      result: redactSecrets(result)
    };

    await writeJson(this.paths.summaryFile, summary);
    return summary;
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.globalDir, { recursive: true }),
      mkdir(this.paths.turnsDir, { recursive: true }),
      mkdir(this.paths.rawScreenshotsDir, { recursive: true }),
      mkdir(this.paths.visionDir, { recursive: true }),
      mkdir(this.paths.errorsDir, { recursive: true })
    ]);
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
    return value
      .replace(inlineImageDataUrlPattern, "data:image/[redacted];base64,[REDACTED]")
      .replace(secretValuePattern, "[REDACTED]");
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
