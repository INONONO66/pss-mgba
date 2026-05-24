import type { CommandPolicy, PolicyInput } from "../ai/Policy.js";
import type { Command, CommandResult, CommandHistoryEntry, GameMode } from "../control/CommandTypes.js";
import type { ExecutionContext } from "../executor/CommandExecutor.js";
import { executeCommand } from "../executor/CommandExecutor.js";
import type { MapMemory } from "../pokemon/MapMemory.js";
import { MapGraph, type MapGraphInput } from "../pokemon/MapGraph.js";
import type { FullGameState } from "../pokemon/PokemonTypes.js";
import type { HarnessStatus, FrameNumber } from "../types.js";
import type { DetectorStatus, ProgressDetector } from "../pokemon/Detector.js";
import { HarnessError } from "../errors.js";

const MAX_GUARD_RETRIES = 3;
const HISTORY_LIMIT = 10;
const AUTO_ADVANCE_LIMIT = 30;
const AUTO_ADVANCE_FRAMES = 8;
const AUTO_ADVANCE_DELAY_MS = 80;

export interface CommandRunnerOptions {
  policy: CommandPolicy;
  executionContext: ExecutionContext;
  mapMemory: MapMemory;
  mapGraph: MapGraph;
  detector: ProgressDetector<Record<string, unknown>, DetectorStatus>;
  stepDelayMs: number;
  readGameState: () => Promise<CommandRunnerGameState>;
  updateMapMemory: () => Promise<void>;
  updateMapGraph: () => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  onStep?: (step: number, command: Command, result: CommandResult) => Promise<void>;
  onAutoAdvance?: (step: number) => Promise<void>;
}

export interface WarpInfo {
  y: number;
  x: number;
  destWarpId: number;
  destMapId: number;
  destMapName: string;
}

export interface NpcInfo {
  slot: number;
  pictureId: number;
  mapY: number;
  mapX: number;
  facing: string;
  movementType: string;
}

export interface CommandRunnerGameState {
  fullState: FullGameState;
  mode: GameMode;
  mapId: number;
  playerY: number;
  playerX: number;
  facing: string;
  mapWidth: number;
  mapHeight: number;
  warps: WarpInfo[];
  npcs: NpcInfo[];
}

export interface CommandRunResult {
  status: HarnessStatus;
  totalSteps: number;
  llmCalls: number;
  commandHistory: readonly CommandHistoryEntry[];
  detector: DetectorStatus;
  startedAt: string;
  completedAt: string;
}

export class CommandHarnessRunner {
  private readonly commandHistory: CommandHistoryEntry[] = [];
  private step = 0;
  private llmCalls = 0;
  private lastResult: CommandResult | undefined;

  constructor(private readonly options: CommandRunnerOptions) {}

  async run(): Promise<CommandRunResult> {
    const startedAt = this.nowIso();

    while (true) {
      const status = this.detectorStatus();
      if (status.status === "completed" || status.checkpoints.completed === true) {
        return this.result("completed", startedAt);
      }

      const state = await this.options.readGameState();
      this.updateExecutionContext(state);
      await this.options.updateMapMemory();
      this.options.updateMapGraph();

      if (state.mode === "dialog" && !(await this.isDialogDecisionNeeded())) {
        console.log(`[auto-advance] dialog detected at loop start, pressing A...`);
        const texts = await this.autoAdvanceDialog();
        if (texts.length > 0) {
          this.lastResult = { status: "success", reason: "dialog_ended", details: `Dialog: ${texts.join(" | ")}` };
        }
        continue;
      }

      const commandStatus = await this.chooseAndExecute(state);
      if (commandStatus !== "running") {
        return this.result(commandStatus, startedAt);
      }

      const postState = await this.options.readGameState();
      this.updateExecutionContext(postState);
      if (postState.mode === "dialog" && !(await this.isDialogDecisionNeeded())) {
        console.log(`[auto-advance] dialog detected after command, pressing A...`);
        const texts = await this.autoAdvanceDialog();
        if (texts.length > 0) {
          this.lastResult = { status: "success", reason: "dialog_ended", details: `Dialog: ${texts.join(" | ")}` };
        }
      }

      const detectorStatus = this.options.detector.update(state.fullState as unknown as Record<string, unknown>, undefined, this.step as FrameNumber);
      if (detectorStatus.status === "completed" || detectorStatus.checkpoints.completed === true) {
        return this.result("completed", startedAt);
      }

      if (this.options.stepDelayMs > 0) {
        await this.sleep(this.options.stepDelayMs);
      }
    }
  }

  private async chooseAndExecute(state: CommandRunnerGameState): Promise<HarnessStatus> {
    for (let retry = 0; retry <= MAX_GUARD_RETRIES; retry += 1) {
      const decision = await this.options.policy.chooseAction(this.buildPolicyInput(state));
      this.llmCalls += 1;
      const result = await executeCommand(decision.command, this.options.executionContext);
      this.lastResult = result;
      this.recordHistory(decision.command, result);

      if (result.status === "rejected") {
        if (retry === MAX_GUARD_RETRIES) {
          throw new HarnessError("ACTION_REJECTED", "Command guard rejected all retry attempts", {
            context: { retries: MAX_GUARD_RETRIES, reason: result.reason, details: result.details },
          });
        }
        continue;
      }

      await this.options.onStep?.(this.step, decision.command, result);
      this.step += 1;
      return "running";
    }

    return "failed_llm";
  }

  private buildPolicyInput(state: CommandRunnerGameState): PolicyInput {
    return {
      mode: state.mode,
      lastResult: this.lastResult,
      commandHistory: [...this.commandHistory],
      mapGraph: this.options.mapGraph.renderForLLM(state.mapId),
      currentMapFull: state.mode !== "battle"
        ? this.options.mapMemory.renderFullMap(state.mapId, state.playerY, state.playerX, state.warps)
        : undefined,
      microContext: state.mode !== "battle" ? {
        position: { y: state.playerY, x: state.playerX },
        facing: state.facing,
        adjacent: this.getAdjacentTiles(state),
        warps: state.warps,
        npcs: state.npcs,
      } : undefined,
      fullState: state.fullState,
      step: this.step,
      detectorStatus: this.detectorStatus(),
    };
  }

  private recordHistory(command: Command, result: CommandResult): void {
    this.commandHistory.push({ command, result, step: this.step });
    if (this.commandHistory.length > HISTORY_LIMIT) {
      this.commandHistory.splice(0, this.commandHistory.length - HISTORY_LIMIT);
    }
  }

  private async autoAdvanceDialog(): Promise<string[]> {
    const collectedTexts: string[] = [];
    let noTextCount = 0;

    for (let press = 0; press < AUTO_ADVANCE_LIMIT; press += 1) {
      const preText = await this.options.executionContext.dialogStateReader.readScreenText();
      if (preText.trim().length > 0) {
        noTextCount = 0;
        if (!collectedTexts.includes(preText.trim())) {
          collectedTexts.push(preText.trim());
        }
      } else {
        noTextCount += 1;
        if (noTextCount >= 3) {
          console.log(`[auto-advance] no text for ${noTextCount} reads, exiting (false positive)`);
          return collectedTexts;
        }
      }

      await this.options.executionContext.controller.pressButton("A", AUTO_ADVANCE_FRAMES);
      await this.options.onAutoAdvance?.(this.step);
      await this.sleep(AUTO_ADVANCE_DELAY_MS);

      const state = await this.options.readGameState();
      this.updateExecutionContext(state);

      if (await this.isDialogDecisionNeeded()) {
        const choiceText = await this.options.executionContext.dialogStateReader.readScreenText();
        if (choiceText.trim().length > 0 && !collectedTexts.includes(choiceText.trim())) {
          collectedTexts.push(choiceText.trim());
        }
        console.log(`[auto-advance] choice detected after ${press + 1} presses, collected ${collectedTexts.length} text(s)`);
        return collectedTexts;
      }

      if (state.mode !== "dialog" && state.fullState.dialog.textBoxId === 0) {
        console.log(`[auto-advance] dialog ended after ${press + 1} presses, collected ${collectedTexts.length} text(s)`);
        return collectedTexts;
      }
    }
    console.log(`[auto-advance] max presses reached, collected ${collectedTexts.length} text(s)`);
    return collectedTexts;
  }

  private async isDialogDecisionNeeded(): Promise<boolean> {
    const reader = this.options.executionContext.dialogStateReader;
    const [choiceActive, namingScreenActive] = await Promise.all([
      reader.isChoiceActive(),
      reader.isNamingScreenActive(),
    ]);
    return choiceActive || namingScreenActive;
  }

  private getAdjacentTiles(state: CommandRunnerGameState): Record<string, string> {
    const rendered = this.options.mapMemory.renderMicro(state.mapId, state.playerY, state.playerX, state.facing);
    const adjacentLine = rendered.split("\n").find((line) => line.startsWith("Adjacent: "));
    if (adjacentLine === undefined) {
      return {};
    }

    return Object.fromEntries(adjacentLine.slice("Adjacent: ".length).split(", ").map((entry) => {
      const [direction, tile] = entry.split(":");
      return [direction?.toLowerCase() ?? entry, tile ?? "unknown"];
    }));
  }

  private updateExecutionContext(state: CommandRunnerGameState): void {
    this.options.executionContext.mode = state.mode;
    this.options.executionContext.fullState = state.fullState;
    this.options.executionContext.mapWidth = state.mapWidth;
    this.options.executionContext.mapHeight = state.mapHeight;
  }

  private detectorStatus(): DetectorStatus {
    return this.options.detector.getStatus();
  }

  private result(status: HarnessStatus, startedAt: string): CommandRunResult {
    return {
      status,
      totalSteps: this.step,
      llmCalls: this.llmCalls,
      commandHistory: [...this.commandHistory],
      detector: this.detectorStatus(),
      startedAt,
      completedAt: this.nowIso(),
    };
  }

  private async sleep(ms: number): Promise<void> {
    const sleepFn = this.options.sleep ?? ((duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)));
    await sleepFn(ms);
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

export type { MapGraphInput };
