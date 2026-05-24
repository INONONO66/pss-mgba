import type { FullGameState } from "../pokemon/PokemonTypes.js";

export type SupervisorProgressState = "progressing" | "stuck" | "blocked" | "complete";

export type SupervisorGoalKind =
  | "clear-dialog"
  | "complete-naming"
  | "win-battle"
  | "recover-from-loop"
  | "explore"
  | "advance-story"
  | "earn-badges"
  | "reach-ending"
  | "complete";

export type SupervisorGoalStatus = "active" | "pending" | "complete";

export interface SupervisorGoal {
  readonly id: string;
  readonly kind: SupervisorGoalKind;
  readonly title: string;
  readonly status: SupervisorGoalStatus;
  readonly priority: number;
  readonly why: string;
  readonly successCriteria: readonly string[];
}

export interface SupervisorAssessment {
  readonly state: SupervisorProgressState;
  readonly reasons: readonly string[];
  readonly repeatedActionCount: number;
  readonly stableLocationCount: number;
}

export interface SupervisorPlan {
  readonly version: 1;
  readonly generatedAtStep?: number;
  readonly assessment: SupervisorAssessment;
  readonly activeGoal: SupervisorGoal;
  readonly goals: readonly SupervisorGoal[];
  readonly guidance: readonly string[];
  readonly avoid: readonly string[];
  readonly citations: readonly string[];
}

export type SupervisorEventType =
  | "supervisor.goal.updated"
  | "supervisor.stuck.detected"
  | "supervisor.improvement.recorded";

export interface SupervisorEventMetadata {
  readonly runId?: string;
  readonly step?: number;
  readonly timestamp: string;
}

export interface SupervisorEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly schema: "openomni.supervisor.event.v1";
  readonly source: "pss-mgba";
  readonly type: SupervisorEventType;
  readonly timestamp: string;
  readonly runId?: string;
  readonly step?: number;
  readonly payload: TPayload;
}

export interface SupervisorGoalUpdatePayload extends Record<string, unknown> {
  readonly activeGoal: SupervisorGoal;
  readonly previousActiveGoal?: SupervisorGoal;
  readonly assessment: SupervisorAssessment;
  readonly guidance: readonly string[];
}

export interface SupervisorStuckPayload extends Record<string, unknown> {
  readonly assessment: SupervisorAssessment;
  readonly activeGoal?: SupervisorGoal;
  readonly reasons: readonly string[];
}

export interface SupervisorImprovementPayload extends Record<string, unknown> {
  readonly id: string;
  readonly stuckReason: string;
  readonly hypothesis: string;
  readonly guidance: readonly string[];
  readonly validation?: string;
}

export interface SupervisorInput {
  readonly step?: number;
  readonly fullState?: FullGameState;
  readonly detectorStatus?: unknown;
  readonly recentActions?: readonly unknown[];
  readonly recentStates?: readonly unknown[];
  readonly mapFresh?: boolean;
  readonly mapStateWarning?: string;
  readonly mapStateError?: string;
}
