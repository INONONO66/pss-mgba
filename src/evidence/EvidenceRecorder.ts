import { mkdir, writeFile } from "node:fs/promises";
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

export interface RunSummary {
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

export interface TurnRunContext {
  readonly runId: string;
  readonly runner: string;
  readonly objective: string;
  readonly sessionKey: string;
  readonly maxTurns: number;
  readonly startedAt: string;
  readonly status: HarnessStatus | "running";
}

export interface TurnTimelineEvent {
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isGameAction?: boolean;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly text?: string;
  readonly message?: string;
  readonly command?: unknown;
  readonly result?: unknown;
}

export interface TurnToolCallLog {
  input?: unknown;
  readonly isGameAction: boolean;
  output?: unknown;
  readonly toolCallId: string;
  readonly toolName: string;
}

export interface TurnLog {
  readonly version: 1;
  readonly turn: number;
  readonly run: TurnRunContext;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly frame: { readonly before?: number; readonly after?: number };
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly reasoning: string;
  readonly response: string;
  readonly parsedCommand?: unknown;
  readonly rationale?: string;
  readonly timeline: readonly TurnTimelineEvent[];
  readonly toolCalls: readonly TurnToolCallLog[];
  readonly gameState: { readonly before: unknown; readonly after?: unknown };
  readonly agentMemory: unknown;
  readonly mapAscii: string;
  readonly mapGraph: string;
  readonly detector: unknown;
  readonly history: readonly unknown[];
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
    assertCompleteTurnLog(turn, this.paths.runId);
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


function assertCompleteTurnLog(turn: TurnLog, expectedRunId: string): void {
  const missing: string[] = [];
  if (turn.version !== 1) missing.push("version");
  if (!Number.isInteger(turn.turn) || turn.turn < 1) missing.push("turn");
  if (!isNonEmptyString(turn.startedAt)) missing.push("startedAt");
  if (!isNonEmptyString(turn.finishedAt)) missing.push("finishedAt");
  if (!isRecord(turn.run) || !isNonEmptyString(turn.run.runId) || turn.run.runId !== expectedRunId || !isNonEmptyString(turn.run.runner) || !isNonEmptyString(turn.run.objective) || !isNonEmptyString(turn.run.sessionKey) || !Number.isInteger(turn.run.maxTurns) || turn.run.maxTurns < 1 || !isNonEmptyString(turn.run.startedAt) || !isNonEmptyString(turn.run.status)) missing.push("run");
  if (!isRecord(turn.frame)) missing.push("frame");
  if (typeof turn.systemPrompt !== "string") missing.push("systemPrompt");
  if (typeof turn.userPrompt !== "string") missing.push("userPrompt");
  if (typeof turn.reasoning !== "string") missing.push("reasoning");
  if (typeof turn.response !== "string") missing.push("response");
  if (!Array.isArray(turn.timeline) || !turn.timeline.every(isTimelineEvent)) missing.push("timeline");
  if (!Array.isArray(turn.toolCalls)) missing.push("toolCalls");
  if (!isRecord(turn.gameState) || !("before" in turn.gameState)) missing.push("gameState.before");
  if (turn.agentMemory === undefined) missing.push("agentMemory");
  if (typeof turn.mapAscii !== "string") missing.push("mapAscii");
  if (typeof turn.mapGraph !== "string") missing.push("mapGraph");
  if (turn.detector === undefined) missing.push("detector");
  if (!Array.isArray(turn.history)) missing.push("history");

  if (missing.length > 0) {
    throw new Error(`Turn log is missing required integrated fields: ${missing.join(", ")}`);
  }
}


function isTimelineEvent(value: unknown): value is TurnTimelineEvent {
  return isRecord(value) &&
    Number.isInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    isNonEmptyString(value.timestamp) &&
    isNonEmptyString(value.type);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
