import path from "node:path";
import type { LanguageModel } from "ai";
import { GoalLedger } from "./GoalLedger.js";
import { KnowledgeBase } from "./KnowledgeBase.js";
import { LLMAdviser, type VisionInterventionResult } from "./LLMAdviser.js";
import { buildPokemonSupervisorPlan } from "./PokemonSupervisor.js";
import { renderSupervisorPlan } from "./SupervisorSummary.js";
import type { SupervisorInput, SupervisorPlan } from "./SupervisorTypes.js";
import { WalkthroughSearcher } from "./WalkthroughSearcher.js";

export interface OrchestratorConfig {
  readonly evidenceDir: string;
  readonly runId: string;
  readonly stuckThresholds?: { readonly repeatedActionCount: number; readonly stableLocationCount: number };
  readonly adviserModel?: LanguageModel;
  readonly adviserCooldownTurns?: number;
  readonly exaApiKey?: string;
}

export class SupervisorOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly goalLedger: GoalLedger;
  private readonly knowledgeBase: KnowledgeBase;
  private readonly llmAdviser: LLMAdviser | undefined;
  private readonly walkthroughSearcher: WalkthroughSearcher;
  private lastPlan: SupervisorPlan | undefined;
  private lastInput: SupervisorInput | undefined;
  private screenshotPath: string | undefined;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.goalLedger = new GoalLedger();
    this.knowledgeBase = new KnowledgeBase(
      path.join(config.evidenceDir, "global", "adviser-knowledge.json"),
    );
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
    }

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

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}
