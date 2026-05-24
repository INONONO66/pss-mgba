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
