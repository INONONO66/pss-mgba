import path from "node:path";
import type { LanguageModel } from "ai";
import { GoalLedger } from "./GoalLedger.js";
import { KnowledgeBase } from "./KnowledgeBase.js";
import { LLMAdviser, type VisionInterventionResult } from "./LLMAdviser.js";
import { PersistentMemory, type PersistentMemoryEntry } from "./PersistentMemory.js";
import { buildPokemonSupervisorPlan } from "./PokemonSupervisor.js";
import { StuckEscalator } from "./StuckEscalator.js";
import { renderSupervisorPlan } from "./SupervisorSummary.js";
import type { SupervisorInput, SupervisorPlan } from "./SupervisorTypes.js";
import { WalkthroughSearcher } from "./WalkthroughSearcher.js";

export interface OrchestratorConfig {
  readonly evidenceDir: string;
  readonly runId: string;
  readonly adviserModel?: LanguageModel;
  readonly adviserCooldownTurns?: number;
  readonly exaApiKey?: string;
  readonly escalationThreshold?: number;
  readonly persistentMemoryPath?: string;
  readonly onEscalation?: (result: { issueNumber: number; issueUrl: string; situationKey: string }) => void;
}

interface StuckContext {
  readonly startStep: number;
  readonly mapId: number;
  readonly mapName: string;
  readonly badges: number;
  readonly reasons: readonly string[];
  readonly goalKind: string;
  readonly goalTitle: string;
  readonly adviserHintUsed: boolean;
  readonly interventionUsed: boolean;
}

export class SupervisorOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly goalLedger: GoalLedger;
  private readonly knowledgeBase: KnowledgeBase;
  private readonly persistentMemory: PersistentMemory;
  private readonly llmAdviser: LLMAdviser | undefined;
  private readonly stuckEscalator: StuckEscalator;
  private readonly walkthroughSearcher: WalkthroughSearcher;
  private adviserHintGivenThisCycle = false;
  private interventionAttemptedThisCycle = false;
  private lastPlan: SupervisorPlan | undefined;
  private lastInput: SupervisorInput | undefined;
  private screenshotPath: string | undefined;
  private stuckContext: StuckContext | undefined;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.goalLedger = new GoalLedger();
    this.knowledgeBase = new KnowledgeBase(
      path.join(config.evidenceDir, "global", "adviser-knowledge.json"),
    );
    this.persistentMemory = new PersistentMemory(
      config.persistentMemoryPath ?? path.join("data", "persistent-memory.json"),
    );
    this.stuckEscalator = new StuckEscalator({
      evidenceDir: config.evidenceDir,
      runId: config.runId,
      escalationThreshold: config.escalationThreshold,
    });
    this.walkthroughSearcher = new WalkthroughSearcher({
      apiKey: config.exaApiKey ?? process.env.EXA_API_KEY,
    });
    this.llmAdviser = config.adviserModel
      ? new LLMAdviser({
          model: config.adviserModel,
          cooldownTurns: config.adviserCooldownTurns ?? 10,
        })
      : undefined;
  }

  async init(): Promise<void> {
    await this.knowledgeBase.load();
    await this.persistentMemory.load();
  }

  update(input: SupervisorInput): SupervisorPlan {
    this.lastInput = input;

    const plan = buildPokemonSupervisorPlan(input);
    this.lastPlan = plan;

    const metadata = {
      runId: this.config.runId,
      step: input.step,
      timestamp: new Date().toISOString(),
    };

    this.goalLedger.updatePlan(plan, metadata);
    if (plan.assessment.state === "stuck") {
      this.goalLedger.recordStuckDetection(plan.assessment, metadata, plan.activeGoal);

      // Capture stuck context on first detection
      if (this.stuckContext === undefined && input.fullState) {
        this.stuckContext = {
          startStep: input.step ?? 0,
          mapId: input.fullState.player.position.mapId,
          mapName: input.fullState.map.mapName,
          badges: input.fullState.player.badges.count,
          reasons: [...plan.assessment.reasons],
          goalKind: plan.activeGoal.kind,
          goalTitle: plan.activeGoal.title,
          adviserHintUsed: false,
          interventionUsed: false,
        };
      }

      const snapshot = {
        step: input.step ?? 0,
        assessment: plan.assessment,
        activeGoal: plan.activeGoal,
        fullState: input.fullState,
        screenshotPath: this.screenshotPath,
        adviserHintGiven: this.adviserHintGivenThisCycle,
        interventionAttempted: this.interventionAttemptedThisCycle,
      };
      this.stuckEscalator.reportStuck(snapshot);
      this.stuckEscalator.maybeEscalate(snapshot).then((result) => {
        if (result) {
          this.config.onEscalation?.(result);
        }
      }).catch(() => { /* escalation is best-effort */ });
    } else {
      // Stuck → resolved transition: auto-record to persistent memory
      if (this.stuckContext !== undefined) {
        this.recordStuckResolution(input, plan).catch(() => {
          /* persistent memory recording is best-effort */
        });
        this.stuckContext = undefined;
      }
      this.stuckEscalator.reportProgress();
    }

    this.adviserHintGivenThisCycle = false;
    this.interventionAttemptedThisCycle = false;

    return plan;
  }

  async getAdviserHint(): Promise<string | undefined> {
    if (!this.lastPlan) {
      return;
    }

    const isStuck = this.lastPlan.assessment.state === "stuck";

    if (!isStuck && this.lastPlan.assessment.state === "progressing" && !hasSignificantState(this.lastInput, this.lastPlan)) {
      return;
    }

    if (isStuck && this.lastInput?.fullState) {
      const situationKey = buildSituationKey(this.lastInput, this.lastPlan);

      const cached = this.knowledgeBase.lookup(situationKey);
      if (cached) {
        this.adviserHintGivenThisCycle = true;
        this.markStuckContextAdviserUsed();
        return truncate(`[Cached advice] ${cached.advice}`, 500);
      }

      if (this.llmAdviser && this.lastInput.step !== undefined) {
        const walkthroughContext = await this.searchWalkthroughContext();
        const result = await this.llmAdviser.advise(
          {
            fullState: this.lastInput.fullState,
            stuckReasons: this.lastPlan.assessment.reasons,
            visitedMapIds: this.extractVisitedMapIds(),
            currentGoal: this.lastPlan.activeGoal.title,
            walkthroughContext,
          },
          this.lastInput.step,
        );

        if (result) {
          this.knowledgeBase.record({
            situationKey: result.situationKey,
            advice: result.advice,
            mapId: this.lastInput.fullState.player.position.mapId,
            badges: this.lastInput.fullState.player.badges.count,
          });
          await this.knowledgeBase.save();
          this.adviserHintGivenThisCycle = true;
          this.markStuckContextAdviserUsed();
          return truncate(`[Expert advice] ${result.advice}`, 500);
        }
      }
    }

    const renderedPlan = renderSupervisorPlan(this.lastPlan);
    return truncate(renderedPlan, 500);
  }

  getLedger(): GoalLedger {
    return this.goalLedger;
  }

  getLastPlan(): SupervisorPlan | undefined {
    return this.lastPlan;
  }

  getKnowledgeBase(): KnowledgeBase {
    return this.knowledgeBase;
  }

  setScreenshotPath(screenshotPath: string): void {
    this.screenshotPath = screenshotPath;
  }

  async getStuckIntervention(): Promise<VisionInterventionResult | undefined> {
    if (!this.lastPlan || this.lastPlan.assessment.state !== "stuck") {
      return;
    }
    if (!this.llmAdviser || !this.lastInput?.fullState || !this.screenshotPath || this.lastInput.step === undefined) {
      return;
    }

    this.interventionAttemptedThisCycle = true;
    this.markStuckContextInterventionUsed();
    return this.llmAdviser.intervene(
      {
        screenshotPath: this.screenshotPath,
        fullState: this.lastInput.fullState,
        stuckReasons: this.lastPlan.assessment.reasons,
        currentGoal: this.lastPlan.activeGoal.title,
      },
      this.lastInput.step,
    );
  }

  getStuckEscalator(): StuckEscalator {
    return this.stuckEscalator;
  }

  getPersistentMemory(): PersistentMemory {
    return this.persistentMemory;
  }

  queryRelevantMemories(
    mapId: number,
    badges: number,
    tags?: readonly string[],
  ): readonly PersistentMemoryEntry[] {
    return this.persistentMemory.query({ mapId, badges, tags });
  }

  private async recordStuckResolution(
    input: SupervisorInput,
    plan: SupervisorPlan,
  ): Promise<void> {
    const ctx = this.stuckContext;
    if (ctx === undefined) {
      return;
    }

    const currentStep = input.step ?? 0;
    const turnsStuck = currentStep - ctx.startStep;
    const resolvedMapName = input.fullState?.map.mapName ?? ctx.mapName;

    const resolution = buildResolutionDescription(ctx, plan, turnsStuck, resolvedMapName);

    await this.persistentMemory.record({
      runId: this.config.runId,
      kind: "mistake_resolved",
      mapId: ctx.mapId,
      mapName: ctx.mapName,
      badges: ctx.badges,
      situation: truncate(
        `[${ctx.goalTitle}] ${ctx.reasons.join("; ")}`,
        400,
      ),
      resolution: truncate(resolution, 400),
      tags: [
        `map:${ctx.mapId}`,
        `goal:${ctx.goalKind}`,
        `badges:${ctx.badges}`,
        ...(ctx.adviserHintUsed ? ["adviser_hint"] : []),
        ...(ctx.interventionUsed ? ["vision_intervention"] : []),
      ],
    });
  }

  private markStuckContextAdviserUsed(): void {
    if (this.stuckContext !== undefined) {
      this.stuckContext = { ...this.stuckContext, adviserHintUsed: true };
    }
  }

  private markStuckContextInterventionUsed(): void {
    if (this.stuckContext !== undefined) {
      this.stuckContext = { ...this.stuckContext, interventionUsed: true };
    }
  }

  private extractVisitedMapIds(): number[] {
    if (!this.lastInput?.recentStates) {
      return [];
    }
    const mapIds = new Set<number>();
    for (const state of this.lastInput.recentStates) {
      const id = extractMapIdFromState(state);
      if (id !== undefined) {
        mapIds.add(id);
      }
    }
    return [...mapIds];
  }

  private async searchWalkthroughContext(): Promise<string | undefined> {
    if (!this.walkthroughSearcher.enabled || !this.lastInput?.fullState || !this.lastPlan) {
      return;
    }

    const searchResult = await this.walkthroughSearcher.search(
      this.lastInput.fullState.map.mapName,
      this.lastInput.fullState.player.badges.count,
      this.lastPlan.assessment.reasons.join("; "),
    );

    if (searchResult.sections.length === 0) {
      return;
    }

    return searchResult.sections
      .map((section) => `[${section.title}]\n${section.text}`)
      .join("\n\n")
      .slice(0, 3000);
  }
}

function buildSituationKey(input: SupervisorInput, plan: SupervisorPlan): string {
  const mapId = input.fullState?.player.position.mapId ?? "unknown";
  const badges = input.fullState?.player.badges.count ?? 0;
  const goalKind = plan.activeGoal.kind;
  return `map:${mapId}:badges:${badges}:goal:${goalKind}`;
}

function extractMapIdFromState(state: unknown): number | undefined {
  if (state === null || typeof state !== "object") {
    return;
  }
  const record = state as Record<string, unknown>;
  if (typeof record.mapId === "number") {
    return record.mapId;
  }
  const nested = record as { player?: { position?: { mapId?: number } } };
  return nested.player?.position?.mapId;
}

function hasSignificantState(input: SupervisorInput | undefined, plan: SupervisorPlan): boolean {
  return (
    typeof input?.mapStateWarning === "string" ||
    typeof input?.mapStateError === "string" ||
    input?.fullState?.battle.inBattle === true ||
    input?.fullState?.dialog.active === true ||
    input?.fullState?.menuText.screenText.trim().length !== 0 ||
    plan.guidance.length > 2 ||
    plan.assessment.reasons.some((reason) => reason !== "No stall signal detected.")
  );
}

function buildResolutionDescription(
  ctx: StuckContext,
  plan: SupervisorPlan,
  turnsStuck: number,
  resolvedMapName: string,
): string {
  const parts: string[] = [];
  parts.push(`Resolved after ${turnsStuck} turns.`);

  if (ctx.adviserHintUsed) {
    parts.push("Adviser hint was used.");
  }
  if (ctx.interventionUsed) {
    parts.push("Vision intervention was used.");
  }

  const newGoal = plan.activeGoal.title;
  if (resolvedMapName !== ctx.mapName) {
    parts.push(`Moved from ${ctx.mapName} to ${resolvedMapName}.`);
  }
  parts.push(`Now pursuing: ${newGoal}.`);

  return parts.join(" ");
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}
