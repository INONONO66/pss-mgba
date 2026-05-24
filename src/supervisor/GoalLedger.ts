import type {
  SupervisorAssessment,
  SupervisorEvent,
  SupervisorEventMetadata,
  SupervisorGoal,
  SupervisorGoalUpdatePayload,
  SupervisorImprovementPayload,
  SupervisorPlan,
  SupervisorStuckPayload,
} from "./SupervisorTypes.js";

export interface SupervisorImprovementRecord {
  readonly id: string;
  readonly stuckReason: string;
  readonly hypothesis: string;
  readonly guidance: readonly string[];
  readonly validation?: string;
}

export interface GoalLedgerSnapshot {
  readonly revision: number;
  readonly activeGoal?: SupervisorGoal;
  readonly goals: readonly SupervisorGoal[];
  readonly assessment?: SupervisorAssessment;
  readonly events: readonly SupervisorEvent[];
  readonly improvements: readonly SupervisorImprovementRecord[];
}

export class GoalLedger {
  private revision = 0;
  private activeGoal: SupervisorGoal | undefined;
  private goals: SupervisorGoal[] = [];
  private assessment: SupervisorAssessment | undefined;
  private events: SupervisorEvent[] = [];
  private improvements: SupervisorImprovementRecord[] = [];

  updatePlan(plan: SupervisorPlan, metadata: SupervisorEventMetadata): SupervisorEvent<SupervisorGoalUpdatePayload> {
    const previousActiveGoal = this.activeGoal;
    this.revision += 1;
    this.activeGoal = plan.activeGoal;
    this.goals = [...plan.goals];
    this.assessment = plan.assessment;

    const event = supervisorEvent("supervisor.goal.updated", metadata, {
      activeGoal: plan.activeGoal,
      previousActiveGoal,
      assessment: plan.assessment,
      guidance: plan.guidance,
    });
    this.events.push(event);
    return event;
  }

  recordStuckDetection(
    assessment: SupervisorAssessment,
    metadata: SupervisorEventMetadata,
    activeGoal: SupervisorGoal | undefined = this.activeGoal
  ): SupervisorEvent<SupervisorStuckPayload> {
    const event = supervisorEvent("supervisor.stuck.detected", metadata, {
      assessment,
      activeGoal,
      reasons: assessment.reasons,
    });
    this.events.push(event);
    return event;
  }

  recordImprovement(
    record: SupervisorImprovementRecord,
    metadata: SupervisorEventMetadata
  ): SupervisorEvent<SupervisorImprovementPayload> {
    this.improvements.push(record);
    const event = supervisorEvent("supervisor.improvement.recorded", metadata, {
      id: record.id,
      stuckReason: record.stuckReason,
      hypothesis: record.hypothesis,
      guidance: record.guidance,
      validation: record.validation,
    });
    this.events.push(event);
    return event;
  }

  snapshot(): GoalLedgerSnapshot {
    return {
      revision: this.revision,
      activeGoal: this.activeGoal,
      goals: [...this.goals],
      assessment: this.assessment,
      events: [...this.events],
      improvements: [...this.improvements],
    };
  }

  drainEvents(): SupervisorEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

export function supervisorEvent<TPayload extends Record<string, unknown>>(
  type: SupervisorEvent<TPayload>["type"],
  metadata: SupervisorEventMetadata,
  payload: TPayload
): SupervisorEvent<TPayload> {
  return {
    schema: "openomni.supervisor.event.v1",
    source: "pss-mgba",
    type,
    timestamp: metadata.timestamp,
    runId: metadata.runId,
    step: metadata.step,
    payload,
  };
}
