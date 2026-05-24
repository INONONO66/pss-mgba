import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HarnessConfig } from "../config.js";
import type { Policy, PolicyInput, PokemonStateSnapshot, RecentStateSnapshot, VisionImageInput } from "../ai/Policy.js";
import type { PolicyDecision } from "../control/ActionTypes.js";
import type { ScreenshotMetadata } from "../evidence/EvidenceRecorder.js";
import { HarnessError, type SerializedHarnessError } from "../errors.js";
import type { DetectorStatus, ProgressDetector } from "../pokemon/Detector.js";
import type { FrameNumber, HarnessErrorCode, HarnessStatus, RunId } from "../types.js";
import type { MapMemory } from "../pokemon/MapMemory.js";
import type { GameWorldSnapshot } from "../pokemon/GameWorld.js";
import type { FullGameState, MenuTextState } from "../pokemon/PokemonTypes.js";
import { buildStateSummary } from "../pokemon/StateSummary.js";
import { GoalLedger } from "../supervisor/GoalLedger.js";
import { buildPokemonSupervisorPlan } from "../supervisor/PokemonSupervisor.js";
import type { SupervisorEvent } from "../supervisor/SupervisorTypes.js";

export interface RunnerClient {
  currentFrame(): Promise<FrameNumber>;
  screenshot(path?: string): Promise<string>;
}

export interface RunnerStateReader<TState = PokemonStateSnapshot> {
  readState(): Promise<TState>;
  readFullState?(context?: { readonly menuText?: MenuTextState }): Promise<FullGameState>;
  getLastTileMapBytes?(): Uint8Array | undefined;
}

export interface RunnerController {
  execute(action: unknown): Promise<void>;
}

export interface RunnerEvidenceRecorder {
  readonly paths?: { readonly runId?: string; readonly visionDir?: string; readonly rawScreenshotsDir?: string };
  startRun(config: unknown): Promise<void>;
  recordState(state: unknown): Promise<string>;
  recordDecision(decision: unknown): Promise<void>;
  recordAction(action: unknown): Promise<void>;
  recordScreenshot(metadata: ScreenshotMetadata): Promise<string>;
  recordSupervisorEvent(event: SupervisorEvent): Promise<void>;
  recordError(error: unknown): Promise<string>;
  finishRun(status: HarnessStatus, result?: unknown): Promise<unknown>;
}

export interface RunnerBudgets {
  readonly maxSteps?: number;
  readonly stepDelayMs?: number;
  readonly maxLlmCalls?: number;
  readonly repeatedStateThreshold?: number;
}

export interface HarnessRunnerOptions<TState = PokemonStateSnapshot> {
  readonly config: Pick<HarnessConfig, "harnessRunId" | "harnessMode" | "loopMaxSteps" | "loopStepDelayMs" | "maxLlmCalls" | "aiProvider" | "llmVisionEnabled" | "llmVisionMaxImages">;
  readonly client: RunnerClient;
  readonly stateReader: RunnerStateReader<TState>;
  readonly policy: Policy;
  readonly controller: RunnerController;
  readonly evidence: RunnerEvidenceRecorder;
  readonly detector: ProgressDetector<Record<string, unknown>, DetectorStatus>;
  readonly budgets?: RunnerBudgets;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly visionProcessor?: RunnerVisionProcessor;
  readonly mapMemory?: MapMemory;
  readonly worldReader?: (context?: { readonly tileMapBytes?: Uint8Array }) => Promise<{ world: GameWorldSnapshot; tileMapBytes: Uint8Array }>;
}

export interface RunnerVisionProcessor {
  process(input: { readonly sourcePath: string; readonly step: number; readonly frame: number }): Promise<VisionImageInput>;
}

export interface HarnessSnapshot<TState = PokemonStateSnapshot> {
  readonly step: number;
  readonly frame: FrameNumber;
  readonly state: TState;
  readonly stateFile: string;
  readonly screenshot: ScreenshotMetadata;
  readonly screenshotEvidenceFile: string;
  readonly stateHash: string;
}

export interface RecordedActionSummary {
  readonly step: number;
  readonly frame?: FrameNumber;
  readonly action: PolicyDecision["action"];
  readonly rationale: string;
  readonly confidence: number;
}

export interface HarnessRunResult {
  readonly runId: RunId;
  readonly status: HarnessStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly totalSteps: number;
  readonly finalFrame?: FrameNumber;
  readonly errorCode?: HarnessErrorCode;
  readonly error?: SerializedHarnessError;
  readonly checkpoints: DetectorStatus["checkpoints"];
  readonly detector: DetectorStatus;
  readonly last20Actions: readonly RecordedActionSummary[];
  readonly recentStateHashes: readonly string[];
}

type RunnerFailure = {
  readonly status: HarnessStatus;
  readonly error: HarnessError;
};

const DEFAULT_REPEATED_STATE_THRESHOLD = 30;
const RECENT_LIMIT = 20;

export class HarnessRunner<TState = PokemonStateSnapshot> {
  private readonly config: HarnessRunnerOptions<TState>["config"];
  private readonly client: RunnerClient;
  private readonly stateReader: RunnerStateReader<TState>;
  private readonly policy: Policy;
  private readonly controller: RunnerController;
  private readonly evidence: RunnerEvidenceRecorder;
  private readonly detector: ProgressDetector<Record<string, unknown>, DetectorStatus>;
  private readonly maxSteps: number;
  private readonly stepDelayMs: number;
  private readonly maxLlmCalls: number;
  private readonly repeatedStateThreshold: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly visionProcessor?: RunnerVisionProcessor;
  private readonly mapMemory?: MapMemory;
  private readonly worldReader?: (context?: { readonly tileMapBytes?: Uint8Array }) => Promise<{ world: GameWorldSnapshot; tileMapBytes: Uint8Array }>;
  private readonly recentStates: RecentStateSnapshot[] = [];
  private readonly recentVisionImages: VisionImageInput[] = [];
  private readonly recentStateHashes: string[] = [];
  private readonly last20Actions: RecordedActionSummary[] = [];
  private readonly goalLedger = new GoalLedger();
  private startedAt: string | undefined;
  private step = 0;
  private llmCalls = 0;
  private finalFrame: FrameNumber | undefined;
  private lastWorld: GameWorldSnapshot | undefined;
  private lastMapStateError: string | undefined;
  private lastMapStateWarning: string | undefined;
  private lastMapFresh: boolean | undefined;
  private lastFullState: FullGameState | undefined;
  private lastFullStateError: string | undefined;
  private lastImprovementKey: string | undefined;

  constructor(options: HarnessRunnerOptions<TState>) {
    this.config = options.config;
    this.client = options.client;
    this.stateReader = options.stateReader;
    this.policy = options.policy;
    this.controller = options.controller;
    this.evidence = options.evidence;
    this.detector = options.detector;
    this.maxSteps = options.budgets?.maxSteps ?? options.config.loopMaxSteps;
    this.stepDelayMs = options.budgets?.stepDelayMs ?? options.config.loopStepDelayMs;
    this.maxLlmCalls = options.budgets?.maxLlmCalls ?? options.config.maxLlmCalls;
    this.repeatedStateThreshold = options.budgets?.repeatedStateThreshold ?? DEFAULT_REPEATED_STATE_THRESHOLD;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    this.visionProcessor = options.visionProcessor;
    this.mapMemory = options.mapMemory;
    this.worldReader = options.worldReader;
  }

  async snapshot(step = this.step): Promise<HarnessSnapshot<TState>> {
    const frame = await this.client.currentFrame();
    const state = await this.stateReader.readState();
    const stateHash = stableHash(state);
    const stateFile = await this.evidence.recordState({ step, frame, state, stateHash });
    const screenshotPath = await this.client.screenshot(await this.rawScreenshotPath(step));
    const screenshot = { path: screenshotPath, frame, step, note: "runner_snapshot" };
    const screenshotEvidenceFile = await this.evidence.recordScreenshot(screenshot);

    await this.recordVisionImage(screenshotPath, step, frame);

    this.finalFrame = frame;
    return { step, frame, state, stateFile, screenshot, screenshotEvidenceFile, stateHash };
  }

  async run(): Promise<HarnessRunResult> {
    this.startedAt = this.timestamp();
    await this.evidence.startRun(this.startConfig());

    let failure: RunnerFailure | undefined;
    let status: HarnessStatus = "running";

    while (status === "running") {
      if (this.step >= this.maxSteps) {
        failure = this.timeoutFailure();
        status = failure.status;
        break;
      }

      this.step += 1;

      try {
        const snapshot = await this.snapshot(this.step);
        this.recordRecentState(snapshot);
        await this.updateMapMemory();
        await this.updateFullState(snapshot.state);
        await this.updateSupervisorEvidence();

        const policyInput = this.createPolicyInput(snapshot);
        const decision = await this.chooseDecision(policyInput);
        await this.evidence.recordDecision({
          step: this.step,
          frame: snapshot.frame,
          decision
        });

        await this.controller.execute(decision.action);
        const actionSummary = this.recordAction(snapshot, decision);
        await this.evidence.recordAction(actionSummary);

        const detectorStatus = this.detector.update(toDetectorState(snapshot.state), decision.action, snapshot.frame);
        status = detectorStatus.status;

        if (status === "completed" || status === "failed_stuck") {
          break;
        }

        failure = this.detectRepeatedStateFailure();
        if (failure !== undefined) {
          status = failure.status;
          break;
        }

        if (this.stepDelayMs > 0) {
          await this.sleep(this.stepDelayMs);
        }
      } catch (error) {
        failure = normalizeFailure(error);
        status = failure.status;
      }
    }

    if (failure !== undefined) {
      await this.evidence.recordError(failure.error);
    }

    const result = this.createResult(status, failure?.error);
    await this.evidence.finishRun(status, result);
    return result;
  }

  private async chooseDecision(input: PolicyInput): Promise<PolicyDecision> {
    if (this.config.aiProvider === "openai") {
      if (this.llmCalls >= this.maxLlmCalls) {
        throw new HarnessError("BUDGET_EXCEEDED", "Runner LLM call budget reached", {
          context: { maxLlmCalls: this.maxLlmCalls }
        });
      }
      this.llmCalls += 1;
    }

    try {
      return await this.policy.chooseAction(input);
    } catch (error) {
      throw normalizePolicyError(error);
    }
  }

  private createPolicyInput(snapshot: HarnessSnapshot<TState>): PolicyInput {
    const base: PolicyInput = {
      state: toPolicyState(snapshot.state),
      currentState: snapshot.state,
      recentStates: [...this.recentStates],
      recentActions: [...this.last20Actions],
      ...(this.config.llmVisionEnabled && this.recentVisionImages.length > 0 ? { visionImages: [...this.recentVisionImages] } : {}),
      step: this.step,
      objective: this.objectiveText(),
      detectorStatus: this.detector.getStatus()
    };

    if (this.mapMemory !== undefined && this.lastWorld !== undefined) {
      const mapId = this.lastWorld.mapLayout.mapId;
      const view = this.mapMemory.view(mapId);
      base.mapAscii = this.mapMemory.renderAscii(mapId, this.lastWorld.playerCoords.y, this.lastWorld.playerCoords.x);
      base.walkGrid = this.mapMemory.walkabilityGrid(mapId) ?? undefined;
      base.mapTileCount = view?.tileCount ?? 0;
      base.mapTotalTiles = view ? view.width * view.height : 0;
      base.visitedMaps = this.mapMemory.visitedMaps();
      base.mapFresh = this.lastMapFresh;
      if (this.lastMapStateWarning !== undefined) {
        base.mapStateWarning = this.lastMapStateWarning;
      }
    } else if (this.lastMapStateError !== undefined) {
      base.mapStateError = this.lastMapStateError;
    }

    if (this.lastFullState !== undefined) {
      base.fullState = this.lastFullState;
      base.fullStateSummary = buildStateSummary(this.lastFullState, base.mapAscii, base.visitedMaps);
    } else if (this.lastFullStateError !== undefined) {
      base.fullStateError = this.lastFullStateError;
    }

    return base;
  }

  private async updateFullState(state: TState): Promise<void> {
    if (this.stateReader.readFullState === undefined) return;

    try {
      this.lastFullState = await this.stateReader.readFullState({ menuText: extractMenuTextState(state) });
      this.lastFullStateError = undefined;
    } catch (error) {
      this.lastFullState = undefined;
      this.lastFullStateError = error instanceof Error ? error.message : String(error);
    }
  }

  private async updateSupervisorEvidence(): Promise<void> {
    const plan = buildPokemonSupervisorPlan({
      step: this.step,
      fullState: this.lastFullState,
      detectorStatus: this.detector.getStatus(),
      recentActions: [...this.last20Actions],
      recentStates: [...this.recentStates],
      mapFresh: this.lastMapFresh,
      mapStateWarning: this.lastMapStateWarning,
      mapStateError: this.lastMapStateError,
    });
    const metadata = {
      runId: this.evidence.paths?.runId ?? this.config.harnessRunId,
      step: this.step,
      timestamp: this.timestamp(),
    };

    this.goalLedger.updatePlan(plan, metadata);
    if (plan.assessment.state === "stuck") {
      this.goalLedger.recordStuckDetection(plan.assessment, metadata, plan.activeGoal);
      const stuckReason = plan.assessment.reasons[0] ?? "progress context stayed stable";
      const improvementKey = `${plan.activeGoal.id}:${stuckReason}`;
      if (this.lastImprovementKey !== improvementKey) {
        this.lastImprovementKey = improvementKey;
        this.goalLedger.recordImprovement({
          id: `step-${this.step}-break-loop`,
          stuckReason,
          hypothesis: "The current repeated action is not changing observable game state.",
          guidance: [
            "Choose a different action category than the repeated input.",
            "Move or turn away before interacting with the same target again.",
          ],
          validation: "Next observations should change location, facing, dialog, battle, menu, or story flags.",
        }, metadata);
      }
    }

    for (const event of this.goalLedger.drainEvents()) {
      await this.evidence.recordSupervisorEvent(event);
    }
  }

  private async updateMapMemory(): Promise<void> {
    if (this.mapMemory === undefined || this.worldReader === undefined) return;

    try {
      const { world, tileMapBytes } = await this.worldReader({ tileMapBytes: this.stateReader.getLastTileMapBytes?.() });
      this.lastWorld = world;
      this.lastMapStateError = undefined;
      const updateResult = this.mapMemory.update(world, tileMapBytes);
      this.lastMapFresh = updateResult.status === "updated";
      this.lastMapStateWarning = updateResult.status === "skipped"
        ? `Map context reused; latest map update skipped: ${updateResult.reason}`
        : undefined;
    } catch (error) {
      this.lastWorld = undefined;
      this.lastMapStateError = error instanceof Error ? error.message : String(error);
      this.lastMapStateWarning = undefined;
      this.lastMapFresh = false;
      // MapMemory update is best-effort; don't break the run loop.
    }
  }

  private objectiveText(): string {
    if (this.config.harnessMode === "full-game") {
      return "Progress through Pokemon Red/Blue to Hall of Fame using safe controller inputs only; completion requires observed Hall of Fame map/state.";
    }

    return "Stage 1: progress from the initial Pallet/Red House start through Oak/starter acquisition, Rival battle entry, and Rival battle exit.";
  }

  private async recordVisionImage(sourcePath: string, step: number, frame: FrameNumber): Promise<void> {
    if (!this.config.llmVisionEnabled) {
      return;
    }
    if (this.visionProcessor === undefined) {
      throw new HarnessError("SCREENSHOT_FAILED", "LLM vision is enabled but no screenshot processor is configured");
    }

    const image = await this.visionProcessor.process({ sourcePath, step, frame });
    this.recentVisionImages.push(image);
    trimToLimit(this.recentVisionImages, this.config.llmVisionMaxImages);
  }

  private async rawScreenshotPath(step: number): Promise<string | undefined> {
    const rawScreenshotsDir = this.evidence.paths?.rawScreenshotsDir;
    if (rawScreenshotsDir === undefined) {
      return undefined;
    }

    await mkdir(rawScreenshotsDir, { recursive: true });
    // mGBA-http writes screenshots from the emulator/server process. Use an
    // absolute path so the file lands in this repo's evidence directory even
    // if mGBA-http has a different working directory.
    return path.resolve(rawScreenshotsDir, `${formatSequence(step)}.png`);
  }

  private recordRecentState(snapshot: HarnessSnapshot<TState>): void {
    const state = toPolicyState(snapshot.state) as RecentStateSnapshot;
    this.recentStates.push({ ...state, step: this.step });
    this.recentStateHashes.push(snapshot.stateHash);
    trimToLimit(this.recentStates, RECENT_LIMIT);
    trimToLimit(this.recentStateHashes, RECENT_LIMIT);
  }

  private recordAction(snapshot: HarnessSnapshot<TState>, decision: PolicyDecision): RecordedActionSummary {
    const summary: RecordedActionSummary = {
      step: this.step,
      frame: snapshot.frame,
      action: decision.action,
      rationale: decision.rationale,
      confidence: decision.confidence
    };

    this.last20Actions.push(summary);
    trimToLimit(this.last20Actions, RECENT_LIMIT);
    return summary;
  }

  private detectRepeatedStateFailure(): RunnerFailure | undefined {
    if (this.recentStateHashes.length < this.repeatedStateThreshold) {
      return undefined;
    }

    const repeated = this.recentStateHashes.slice(-this.repeatedStateThreshold);
    const first = repeated[0];
    if (first === undefined || repeated.some((hash) => hash !== first)) {
      return undefined;
    }

    return {
      status: "failed_stuck",
      error: new HarnessError("STUCK", "Runner observed repeated state hash without progress", {
        context: { repeatedStateThreshold: this.repeatedStateThreshold, stateHash: first }
      })
    };
  }

  private timeoutFailure(): RunnerFailure {
    return {
      status: "failed_timeout",
      error: new HarnessError("TIMEOUT", "Runner reached maximum step budget", {
        context: { maxSteps: this.maxSteps }
      })
    };
  }

  private createResult(status: HarnessStatus, error?: HarnessError): HarnessRunResult {
    const detector = this.detector.getStatus();
    return {
      runId: this.evidence.paths?.runId ?? this.config.harnessRunId,
      status,
      startedAt: this.startedAt ?? this.timestamp(),
      completedAt: this.timestamp(),
      totalSteps: this.step,
      finalFrame: this.finalFrame,
      errorCode: error?.code,
      error: error?.toJSON(),
      checkpoints: detector.checkpoints,
      detector,
      last20Actions: [...this.last20Actions],
      recentStateHashes: [...this.recentStateHashes]
    };
  }

  private startConfig(): unknown {
    return {
      runId: this.evidence.paths?.runId ?? this.config.harnessRunId,
      harnessMode: this.config.harnessMode,
      aiProvider: this.config.aiProvider,
      loopMaxSteps: this.maxSteps,
      loopStepDelayMs: this.stepDelayMs,
      maxLlmCalls: this.maxLlmCalls,
      llmVisionEnabled: this.config.llmVisionEnabled,
      llmVisionMaxImages: this.config.llmVisionMaxImages,
      repeatedStateThreshold: this.repeatedStateThreshold
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function normalizeFailure(error: unknown): RunnerFailure {
  const harnessError = error instanceof HarnessError
    ? error
    : new HarnessError("MGBA_UNAVAILABLE", "Runner dependency failed", { cause: error });

  return { status: statusForErrorCode(harnessError.code), error: harnessError };
}

function normalizePolicyError(error: unknown): HarnessError {
  if (error instanceof HarnessError) {
    if (error.code === "BUDGET_EXCEEDED" || error.code === "LLM_UNAVAILABLE" || error.code === "LLM_INVALID_OUTPUT") {
      return error;
    }

    return new HarnessError("LLM_UNAVAILABLE", "Policy failed before producing a controller action", {
      cause: error,
      context: { originalCode: error.code }
    });
  }

  return new HarnessError("LLM_UNAVAILABLE", "Policy failed before producing a controller action", { cause: error });
}

function statusForErrorCode(code: HarnessErrorCode): HarnessStatus {
  switch (code) {
    case "INVALID_RAM_STATE":
      return "failed_invalid_state";
    case "LLM_UNAVAILABLE":
    case "LLM_INVALID_OUTPUT":
      return "failed_llm";
    case "BUDGET_EXCEEDED":
      return "failed_budget";
    case "TIMEOUT":
      return "failed_timeout";
    case "STUCK":
      return "failed_stuck";
    case "ACTION_REJECTED":
    case "MGBA_UNAVAILABLE":
    case "ROM_NOT_LOADED_OR_INVALID":
    case "SCREENSHOT_FAILED":
      return "failed_mgba";
  }
}

function toPolicyState(value: unknown): PokemonStateSnapshot {
  return typeof value === "object" && value !== null ? value as PokemonStateSnapshot : {};
}

function toDetectorState(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}


function extractMenuTextState(value: unknown): MenuTextState | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const menuText = (value as { readonly menuText?: unknown }).menuText;
  if (menuText === null || typeof menuText !== "object") return undefined;

  const candidate = menuText as Partial<MenuTextState>;
  if (
    typeof candidate.currentMenuItem === "number" &&
    typeof candidate.textBoxId === "number" &&
    typeof candidate.letterPrintingDelayFlags === "number" &&
    typeof candidate.screenText === "string" &&
    typeof candidate.screenTextKind === "string" &&
    typeof candidate.namingScreenNameLength === "number" &&
    typeof candidate.namingScreenSubmitName === "number" &&
    typeof candidate.namingScreenType === "number"
  ) {
    return candidate as MenuTextState;
  }

  return undefined;
}

function stableHash(value: unknown): string {
  return stableJson(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }

  return value;
}

function trimToLimit<T>(items: T[], limit: number): void {
  if (items.length > limit) {
    items.splice(0, items.length - limit);
  }
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(6, "0");
}
