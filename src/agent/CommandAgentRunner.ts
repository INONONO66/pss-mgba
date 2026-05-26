import path from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, type AgentEvent, type AgentTools } from "@minpeter/pss-runtime";
import { FileSessionStore } from "@minpeter/pss-runtime/session-store/file";
import type { LanguageModel } from "ai";
import type { HarnessConfig } from "../config.js";
import type {
  Command,
  CommandHistoryEntry,
  CommandResult,
  GameMode,
} from "../control/CommandTypes.js";
import { EvidenceRecorder } from "../evidence/EvidenceRecorder.js";
import { executeCommand } from "../executor/CommandExecutor.js";
import type { DetectorStatus } from "../pokemon/Detector.js";
import type { HarnessStatus } from "../types.js";
import { AgentMemoryStore } from "./AgentMemoryStore";
import {
  type CommandAgentContext,
  type CommandAgentGameState,
  createCommandAgentContext,
} from "./CommandAgentContext";
import { buildAgentObservation } from "./command-observation";
import { createCommandTools } from "./command-tools";
import {
  buildInstructions,
  createDynamicLlm,
  type DynamicLlmContext,
  type DynamicReasoningEffort,
} from "./dynamic-llm";
import { createMemoryTools } from "./memory-tools";
import { createSaveLoadTools } from "./saveload-tools";

const HISTORY_LIMIT = 10;
const AUTO_CHECKPOINT_SLOT = 8;
const AUTO_CHECKPOINT_INTERVAL_TURNS = 20;
const SESSION_DIRECTORY = "agent-sessions";
const AGENT_SCREENSHOT_NOTE = "command_agent_turn_snapshot";

const COMMON_TOOL_NAMES = [
  "pokemon_memory_read",
  "pokemon_memory_write",
] as const;
const WAIT_TOOL_NAMES = ["pokemon_wait"] as const;
const OVERWORLD_TOOL_NAMES = [
  "pokemon_navigate",
  "pokemon_interact",
  "pokemon_save",
  "pokemon_load",
  "pokemon_load_rollback",
] as const;
const DIALOG_TOOL_NAMES = ["pokemon_dialog"] as const;
const BATTLE_TOOL_NAMES = ["pokemon_battle"] as const;
const GAME_ACTION_TOOL_NAMES = new Set([
  "pokemon_navigate",
  "pokemon_interact",
  "pokemon_battle",
  "pokemon_dialog",
  "pokemon_wait",
]);

export interface CommandAgentRunnerOptions {
  readonly adviserHintProvider?: () => Promise<string | undefined>;
  readonly agentMemoryStore?: AgentMemoryStore;
  readonly context?: CommandAgentContext;
  readonly maxTurns?: number;
  readonly model?: LanguageModel;
  readonly now?: () => Date;
  readonly objective?: string;
  readonly onAutoCheckpoint?: (turn: number) => void | Promise<void>;
  readonly onEvent?: (event: AgentEvent, turn: number) => void | Promise<void>;
  readonly onTurnEnd?: (
    turn: number,
    status: DetectorStatus
  ) => void | Promise<void>;
  readonly onTurnStart?: (
    turn: number,
    state: CommandAgentGameState
  ) => void | Promise<void>;
  readonly reasoning?: DynamicReasoningEffort;
  readonly sessionKey?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly systemPrompt?: string;
}

export interface CommandAgentRunResult {
  readonly commandHistory: readonly CommandHistoryEntry[];
  readonly completedAt: string;
  readonly detector: DetectorStatus;
  readonly finalFrame?: number;
  readonly last20Actions: readonly CommandHistoryEntry[];
  readonly llmCalls: number;
  readonly startedAt: string;
  readonly status: HarnessStatus;
  readonly totalSteps: number;
  readonly totalTurns: number;
}

interface PendingToolCallEvidence {
  readonly input: unknown;
  readonly toolName: string;
}

interface TurnToolCallLog {
  readonly input: unknown;
  readonly isGameAction: boolean;
  output?: unknown;
  readonly toolCallId: string;
  readonly toolName: string;
}

interface TurnLogDraft {
  agentMemory: unknown;
  detector: unknown;
  finishedAt?: string;
  frame: { before?: number; after?: number };
  gameState: { before: unknown; after?: unknown };
  history: readonly CommandHistoryEntry[];
  mapAscii?: string;
  mapGraph?: string;
  parsedCommand?: unknown;
  reasoning: string;
  response: string;
  startedAt: string;
  systemPrompt: string;
  toolCalls: TurnToolCallLog[];
  turn: number;
  userPrompt: string;
}

export class CommandAgentRunner {
  private readonly agentMemoryStore: AgentMemoryStore;
  private readonly commandHistory: CommandHistoryEntry[] = [];
  private readonly context: CommandAgentContext;
  private readonly evidence: EvidenceRecorder;
  private readonly maxTurns: number;
  private readonly modeContext: DynamicLlmContext;
  private readonly now: () => Date;
  private readonly objective: string;
  private readonly options: CommandAgentRunnerOptions;
  private readonly pendingToolCalls = new Map<
    string,
    PendingToolCallEvidence
  >();
  private readonly sessionKey: string;
  private finalFrame: number | undefined;
  private llmCalls = 0;
  private lastResult: CommandResult | undefined;
  private rollbackProgressSequence = 0;
  private turn = 0;

  constructor(config: HarnessConfig, options: CommandAgentRunnerOptions = {}) {
    this.context = options.context ?? createCommandAgentContext(config);
    this.agentMemoryStore =
      options.agentMemoryStore ??
      new AgentMemoryStore({
        evidenceDir: config.evidenceDir,
        runId: config.harnessRunId,
      });
    this.maxTurns = Math.max(
      1,
      Math.floor(options.maxTurns ?? config.loopMaxSteps)
    );
    this.now = options.now ?? (() => new Date());
    this.objective = options.objective ?? defaultObjective(config);
    this.options = options;
    this.evidence = new EvidenceRecorder({
      evidenceDir: config.evidenceDir,
      now: this.now,
      runId: config.harnessRunId,
    });
    this.sessionKey = options.sessionKey ?? `pokemon:${config.harnessRunId}`;
    this.modeContext = {
      mode: "overworld",
      reasoning: options.reasoning,
      systemPrompt: options.systemPrompt,
      tools: {},
    };
  }

  async run(): Promise<CommandAgentRunResult> {
    const startedAt = this.nowIso();
    let runResult: CommandAgentRunResult | undefined;

    await this.evidence.startRun({
      aiProvider: this.context.config.aiProvider,
      evidenceDir: this.context.config.evidenceDir,
      harnessMode: this.context.config.harnessMode,
      maxTurns: this.maxTurns,
      objective: this.objective,
      runId: this.context.config.harnessRunId,
      runner: "CommandAgentRunner",
      sessionKey: this.sessionKey,
    });

    try {
      await this.context.mapMemoryStore.loadInto(this.context.mapMemory);
      await this.agentMemoryStore.load();

      const tools = this.createTools();
      this.modeContext.tools = selectToolsForMode(this.modeContext.mode, tools);

      const agent = await Agent.create({
        llm: createDynamicLlm({
          getContext: () => this.modeContext,
          model: this.options.model ?? createDefaultModel(this.context.config),
          reasoning: this.options.reasoning,
          sleep: this.options.sleep,
        }),
        sessions: {
          store: new FileSessionStore(
            path.join(
              this.context.config.evidenceDir,
              this.context.config.harnessRunId,
              SESSION_DIRECTORY
            )
          ),
        },
      });
      const session = agent.session(this.sessionKey);

      let status: HarnessStatus | undefined;
      while (this.turn < this.maxTurns) {
        const preStatus = this.detectorStatus();
        if (isDetectorComplete(preStatus)) {
          status = "completed";
          break;
        }

        let state = await this.refreshState();
        let detectorStatus = this.updateDetector(state);
        if (isDetectorComplete(detectorStatus)) {
          status = "completed";
          break;
        }

        state = await this.autoAdvanceDialog(state);
        detectorStatus = this.updateDetector(state);
        if (isDetectorComplete(detectorStatus)) {
          status = "completed";
          break;
        }

        this.turn += 1;
        const activeTools = this.updateModeContext(state.mode, tools);
        const beforeFrame = await this.safeCurrentFrame();
        await this.recordTurnScreenshot(beforeFrame);
        await this.options.onTurnStart?.(this.turn, state);

        const observation = buildAgentObservation(
          state,
          this.context.mapMemory,
          this.context.mapGraph,
          {
            adviserHint: await this.readAdviserHint(),
            agentMemory: this.agentMemoryStore.snapshot(),
            availableTools: activeTools,
            commandHistory: this.commandHistory,
            detectorStatus,
            lastResult: this.lastResult,
            objective: this.objective,
            step: this.turn,
          }
        );
        const userPrompt = normalizeMessageContent(observation);
        const turnLog: TurnLogDraft = {
          turn: this.turn,
          startedAt: this.nowIso(),
          frame: { before: beforeFrame },
          systemPrompt: buildInstructions(this.modeContext),
          userPrompt:
            typeof userPrompt === "string"
              ? userPrompt
              : JSON.stringify(userPrompt),
          reasoning: "",
          response: "",
          toolCalls: [],
          gameState: { before: state.fullState },
          agentMemory: this.agentMemoryStore.snapshot(),
          mapAscii: this.context.mapMemory.renderFullMap(
            state.mapId,
            state.playerY,
            state.playerX,
            state.warps
          ),
          mapGraph: this.context.mapGraph.renderForLLM(state.mapId),
          detector: detectorStatus,
          history: [...this.commandHistory],
        };

        const run = await session.send({
          type: "user-message",
          content: observation,
        });

        const streamStatus = await this.consumeRunEvents(
          run.stream(),
          () => session.interrupt(),
          tools,
          turnLog
        );
        const afterState = await this.refreshState();
        const afterStatus = this.updateDetector(afterState);
        this.updateModeContext(afterState.mode, tools);
        turnLog.finishedAt = this.nowIso();
        turnLog.frame.after = await this.safeCurrentFrame();
        turnLog.gameState.after = afterState.fullState;
        turnLog.detector = afterStatus;
        turnLog.history = [...this.commandHistory];
        await this.evidence.recordTurn(
          turnLog as Required<Pick<TurnLogDraft, "finishedAt">> & TurnLogDraft
        );
        await this.options.onTurnEnd?.(this.turn, afterStatus);

        if (streamStatus !== "running") {
          status = streamStatus;
          break;
        }
        if (isDetectorComplete(afterStatus)) {
          status = "completed";
          break;
        }

        await this.maybeAutoCheckpoint();
        if (this.context.config.loopStepDelayMs > 0) {
          await this.sleep(this.context.config.loopStepDelayMs);
        }
      }

      runResult = this.result(status ?? "failed_budget", startedAt);
      await this.evidence.finishRun(runResult.status, runResult);
      return runResult;
    } catch (error) {
      await this.evidence.recordError(error);
      await this.evidence.finishRun("failed_mgba", {
        startedAt,
        status: "failed_mgba",
      });
      throw error;
    } finally {
      await this.context.mapMemoryStore.flush(this.context.mapMemory);
    }
  }

  private createTools(): AgentTools {
    return {
      ...createCommandTools(this.context),
      ...createMemoryTools(this.agentMemoryStore),
      ...createSaveLoadTools(
        this.context.client,
        () => this.modeContext.mode,
        this.agentMemoryStore,
        () => this.rollbackProgressSequence
      ),
    } satisfies AgentTools;
  }

  private async consumeRunEvents(
    events: AsyncIterable<AgentEvent>,
    interrupt: () => void,
    tools: AgentTools,
    turnLog?: TurnLogDraft
  ): Promise<HarnessStatus> {
    let interruptedAfterTool = false;
    let toolExecuted = false;

    for await (const event of events) {
      await this.options.onEvent?.(event, this.turn);
      this.recordAgentEventEvidence(event, turnLog);
      this.recordRuntimeEvent(event);

      if (
        event.type === "tool-result" &&
        !toolExecuted &&
        GAME_ACTION_TOOL_NAMES.has(event.toolName)
      ) {
        toolExecuted = true;
        interruptedAfterTool = true;
        interrupt();
        const state = await this.refreshState();
        this.updateDetector(state);
        this.updateModeContext(state.mode, tools);
      }

      if (event.type === "turn-abort") {
        return interruptedAfterTool ? "running" : "failed_budget";
      }
      if (event.type === "turn-error") {
        if (interruptedAfterTool) {
          await this.options.onEvent?.(
            { type: "turn-abort" } as AgentEvent,
            this.turn
          );
        }
        return interruptedAfterTool ? "failed_budget" : "failed_llm";
      }
    }

    return "running";
  }

  private recordRuntimeEvent(event: AgentEvent): void {
    if (event.type === "step-start") {
      this.llmCalls += 1;
      return;
    }

    if (event.type !== "tool-result") {
      return;
    }

    const output = unwrapToolOutput(event.output);
    const command = extractCommand(output);
    const result = extractCommandResult(output);
    if (command === undefined || result === undefined) {
      return;
    }

    this.recordCommand(command, result, this.turn);
  }

  private async autoAdvanceDialog(
    state: CommandAgentGameState
  ): Promise<CommandAgentGameState> {
    if (state.mode !== "dialog") {
      return state;
    }

    const [choiceActive, namingScreenActive] = await Promise.all([
      this.context.dialogStateReader.isChoiceActive(),
      this.context.dialogStateReader.isNamingScreenActive(),
    ]);
    if (choiceActive || namingScreenActive) {
      return state;
    }

    const command: Command = { type: "dialog", action: { kind: "advance" } };
    const result = await executeCommand(command, {
      ...this.context.executionContext,
      mode: "dialog",
    });
    this.recordCommand(command, result, this.turn + 1);

    return this.refreshState();
  }

  private recordCommand(
    command: Command,
    result: CommandResult,
    step: number
  ): void {
    this.lastResult = result;
    if (isProgressResult(result)) {
      this.rollbackProgressSequence += 1;
    }
    this.commandHistory.push({ command, result, step });
    if (this.commandHistory.length > HISTORY_LIMIT) {
      this.commandHistory.splice(0, this.commandHistory.length - HISTORY_LIMIT);
    }
  }

  private async recordTurnScreenshot(frame: number | undefined): Promise<void> {
    const rawPath = path.resolve(
      this.evidence.paths.rawScreenshotsDir,
      `${formatSequence(this.turn)}.png`
    );

    try {
      const savedPath = await this.context.client.screenshot(rawPath);
      await this.evidence.recordScreenshot({
        path: savedPath,
        frame,
        step: this.turn,
        note: AGENT_SCREENSHOT_NOTE,
      });
    } catch (error) {
      await this.evidence.recordScreenshot({
        path: rawPath,
        frame,
        step: this.turn,
        note: `placeholder:${AGENT_SCREENSHOT_NOTE}:${formatErrorMessage(error)}`,
      });
    }
  }

  private async recordAgentEventEvidence(
    event: AgentEvent,
    turnLog?: TurnLogDraft
  ): Promise<void> {
    switch (event.type) {
      case "tool-call":
        this.pendingToolCalls.set(event.toolCallId, {
          input: event.input,
          toolName: event.toolName,
        });
        turnLog?.toolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          isGameAction: GAME_ACTION_TOOL_NAMES.has(event.toolName),
        });
        return;
      case "tool-result": {
        const pending = this.pendingToolCalls.get(event.toolCallId);
        this.pendingToolCalls.delete(event.toolCallId);
        const output = unwrapToolOutput(event.output);
        if (turnLog !== undefined) {
          const toolCall = turnLog.toolCalls.find(
            (entry) => entry.toolCallId === event.toolCallId
          );
          if (toolCall === undefined) {
            turnLog.toolCalls.push({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: pending?.input,
              output,
              isGameAction: GAME_ACTION_TOOL_NAMES.has(event.toolName),
            });
          } else {
            toolCall.output = output;
          }
          turnLog.parsedCommand =
            extractCommand(output) ?? turnLog.parsedCommand;
        }
        await this.recordToolScreenshot(event.toolName, output);
        return;
      }
      case "assistant-reasoning":
        if (turnLog !== undefined) {
          turnLog.reasoning += event.text;
        }
        return;
      case "assistant-text":
        if (turnLog !== undefined) {
          turnLog.response += event.text;
        }
        return;
      case "turn-error":
        await this.evidence.recordError({
          step: this.turn,
          turn: this.turn,
          message: event.message,
          event,
        });
        return;
      default:
        return;
    }
  }

  private async recordToolScreenshot(
    toolName: string,
    output: unknown
  ): Promise<void> {
    if (!toolName.toLowerCase().includes("screenshot")) {
      return;
    }

    const pathValue = extractPath(output);
    if (pathValue === undefined) {
      await this.evidence.recordScreenshot({
        path: `agent-tool:${toolName}:${this.turn}`,
        frame: await this.safeCurrentFrame(),
        step: this.turn,
        note: "placeholder:tool_screenshot_without_path",
      });
      return;
    }

    await this.evidence.recordScreenshot({
      path: pathValue,
      frame: await this.safeCurrentFrame(),
      step: this.turn,
      note: `tool:${toolName}`,
    });
  }

  private async safeCurrentFrame(): Promise<number | undefined> {
    try {
      const frame = await this.context.client.currentFrame();
      this.finalFrame = frame;
      return frame;
    } catch {
      return this.finalFrame;
    }
  }

  private async refreshState(): Promise<CommandAgentGameState> {
    const state = await this.context.readGameState();
    this.context.executionContext.mode = state.mode;
    this.context.executionContext.fullState = state.fullState;
    this.context.executionContext.mapWidth = state.mapWidth;
    this.context.executionContext.mapHeight = state.mapHeight;
    await this.context.updateMapMemory();
    this.context.mapMemoryStore.onUpdate(this.context.mapMemory);
    this.context.updateMapGraph();
    return state;
  }

  private updateDetector(state: CommandAgentGameState): DetectorStatus {
    return this.context.detector.update(
      state.fullState as unknown as Record<string, unknown>,
      undefined,
      this.turn
    );
  }

  private updateModeContext(mode: GameMode, tools: AgentTools): AgentTools {
    this.modeContext.mode = mode;
    const activeTools = selectToolsForMode(mode, tools);
    this.modeContext.tools = activeTools;
    return activeTools;
  }

  private async maybeAutoCheckpoint(): Promise<void> {
    if (this.turn % AUTO_CHECKPOINT_INTERVAL_TURNS !== 0) {
      return;
    }

    await this.context.client.saveStateSlot(AUTO_CHECKPOINT_SLOT);
    await this.options.onAutoCheckpoint?.(this.turn);
  }

  private async readAdviserHint(): Promise<string | undefined> {
    if (this.options.adviserHintProvider === undefined) {
      return;
    }

    const hint = await this.options.adviserHintProvider();
    return hint === undefined ? undefined : hint.slice(0, 500);
  }

  private detectorStatus(): DetectorStatus {
    return this.context.detector.getStatus();
  }

  private result(
    status: HarnessStatus,
    startedAt: string
  ): CommandAgentRunResult {
    return {
      commandHistory: [...this.commandHistory],
      completedAt: this.nowIso(),
      detector: this.detectorStatus(),
      finalFrame: this.finalFrame,
      last20Actions: [...this.commandHistory],
      llmCalls: this.llmCalls,
      startedAt,
      status,
      totalSteps: this.turn,
      totalTurns: this.turn,
    };
  }

  private async sleep(ms: number): Promise<void> {
    const sleepFn =
      this.options.sleep ??
      ((duration: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, duration)));
    await sleepFn(ms);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

function createDefaultModel(config: HarnessConfig): LanguageModel {
  if (config.openaiApiKey === undefined) {
    throw new Error(
      "OPENAI_API_KEY is required for CommandAgentRunner default model creation"
    );
  }

  return createOpenAICompatible({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    name: "pss-runtime-openai-compatible",
  }).chatModel(config.openaiModel);
}

function defaultObjective(config: HarnessConfig): string {
  return config.harnessMode === "full-game"
    ? "Beat the already-loaded Pokemon game from the current emulator state. Completion requires Hall of Fame observation."
    : "Progress through the Stage 1 Pokemon objective from the current emulator state. Do not reset or use hardcoded input timelines.";
}

function isDetectorComplete(status: DetectorStatus): boolean {
  return status.status === "completed" || status.checkpoints.completed === true;
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

function isCommandResult(value: unknown): value is CommandResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly status?: unknown }).status === "string"
  );
}

function isProgressResult(result: CommandResult): boolean {
  return result.status === "success" || result.status === "partial";
}

function selectToolsForMode(mode: GameMode, tools: AgentTools): AgentTools {
  if (mode === "battle") {
    return pickTools(tools, [
      ...COMMON_TOOL_NAMES,
      ...WAIT_TOOL_NAMES,
      ...BATTLE_TOOL_NAMES,
    ]);
  }

  if (mode === "dialog") {
    return pickTools(tools, [...COMMON_TOOL_NAMES, ...DIALOG_TOOL_NAMES]);
  }

  return pickTools(tools, [
    ...COMMON_TOOL_NAMES,
    ...WAIT_TOOL_NAMES,
    ...OVERWORLD_TOOL_NAMES,
  ]);
}

function pickTools(tools: AgentTools, names: readonly string[]): AgentTools {
  return Object.fromEntries(
    names.flatMap((name) => {
      const tool = tools[name];
      return tool === undefined ? [] : [[name, tool]];
    })
  ) as AgentTools;
}

function formatSequence(sequence: number): string {
  return sequence.toString().padStart(6, "0");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unwrapToolOutput(output: unknown): unknown {
  if (
    isRecord(output) &&
    output.type === "json" &&
    "value" in output &&
    Object.keys(output).every((key) => key === "type" || key === "value")
  ) {
    return output.value;
  }

  return output;
}

function extractCommand(output: unknown): Command | undefined {
  if (!isRecord(output)) {
    return;
  }

  return isCommand(output.command) ? output.command : undefined;
}

function extractCommandResult(output: unknown): CommandResult | undefined {
  if (!isRecord(output)) {
    return;
  }

  return isCommandResult(output.result) ? output.result : undefined;
}

function normalizeMessageContent(content: unknown): unknown {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const parts = content.map((part) => {
    if (!isRecord(part)) {
      return String(part);
    }
    if (part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
    if (part.type === "image") {
      return `[image ${typeof part.mediaType === "string" ? part.mediaType : "image"}]`;
    }
    if (part.type === "file") {
      return `[file ${typeof part.filename === "string" ? part.filename : (part.mediaType ?? "file")}]`;
    }
    return JSON.stringify(part);
  });

  return parts.join("\n");
}

function extractPath(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return;
  }

  return typeof value.path === "string" ? value.path : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
