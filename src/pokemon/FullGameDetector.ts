import type { HarnessAction } from "../control/ActionTypes.js";
import type { HarnessStatus } from "../types.js";
import type { DetectorStatus, ProgressDetector } from "./Detector.js";
import { HALL_OF_FAME_MAP_ID } from "./memoryMap.js";
import { type Stage1ObservableState } from "./Stage1Detector.js";
export { HALL_OF_FAME_MAP_ID };

export type FullGameCheckpointName =
  | "initialObserved"
  | "starterAcquired"
  | "rivalBattleEntered"
  | "rivalBattleExited"
  | "badgesObserved"
  | "allBadgesObtained"
  | "hallOfFameObserved"
  | "hallOfFameCompleted"
  | "completed";

export interface FullGameObservableState extends Stage1ObservableState {
  readonly wObtainedBadges?: number;
  readonly badgeCount?: number;
  readonly badgesObtained?: readonly boolean[];
  readonly hallOfFameComplete?: boolean;
}

export interface FullGameObservedFields {
  readonly wCurMap?: number;
  readonly wYCoord?: number;
  readonly wXCoord?: number;
  readonly wPartyCount?: number;
  readonly wIsInBattle?: number;
  readonly wObtainedBadges?: number;
  readonly badgeCount?: number;
  readonly hallOfFameComplete?: boolean;
}

export interface FullGameCheckpoints {
  readonly initialObserved: boolean;
  readonly starterAcquired: boolean;
  readonly rivalBattleEntered: boolean;
  readonly rivalBattleExited: boolean;
  readonly badgesObserved: boolean;
  readonly allBadgesObtained: boolean;
  readonly hallOfFameObserved: boolean;
  readonly hallOfFameCompleted: boolean;
  readonly completed: boolean;
}

export interface FullGameCheckpointEvidence {
  readonly checkpoint: FullGameCheckpointName;
  readonly step: number;
  readonly frame?: number;
  readonly action?: HarnessAction;
  readonly observed: FullGameObservedFields;
}

export interface FullGameStatus extends DetectorStatus<FullGameCheckpoints> {
  readonly status: HarnessStatus;
  readonly checkpoints: FullGameCheckpoints;
  readonly progressStep: number;
  readonly lastProgressStep: number;
  readonly checkpointEvidence: readonly FullGameCheckpointEvidence[];
  readonly lastObserved?: FullGameObservedFields;
}

const EMPTY_CHECKPOINTS: FullGameCheckpoints = {
  initialObserved: false,
  starterAcquired: false,
  rivalBattleEntered: false,
  rivalBattleExited: false,
  badgesObserved: false,
  allBadgesObtained: false,
  hallOfFameObserved: false,
  hallOfFameCompleted: false,
  completed: false
};

function battleFlagFrom(state: FullGameObservableState): number | undefined {
  if (typeof state.wIsInBattle === "number") {
    return state.wIsInBattle === 0 ? 0 : 1;
  }
  if (typeof state.isInBattle === "boolean") {
    return state.isInBattle ? 1 : 0;
  }
  if (typeof state.isInBattle === "number") {
    return state.isInBattle === 0 ? 0 : 1;
  }
  return undefined;
}

function badgeCountFrom(state: FullGameObservableState): number | undefined {
  if (typeof state.badgeCount === "number") {
    return state.badgeCount;
  }
  if (state.badgesObtained !== undefined) {
    return state.badgesObtained.filter(Boolean).length;
  }
  if (typeof state.wObtainedBadges === "number") {
    return countBits(state.wObtainedBadges & 0xff);
  }
  return undefined;
}

function observedFieldsFrom(state: FullGameObservableState): FullGameObservedFields {
  const mapId = state.wCurMap ?? state.mapId;
  return {
    wCurMap: mapId,
    wYCoord: state.wYCoord ?? state.y,
    wXCoord: state.wXCoord ?? state.x,
    wPartyCount: state.wPartyCount ?? state.partyCount,
    wIsInBattle: battleFlagFrom(state),
    wObtainedBadges: state.wObtainedBadges,
    badgeCount: badgeCountFrom(state),
    hallOfFameComplete: state.hallOfFameComplete === true || mapId === HALL_OF_FAME_MAP_ID
  };
}

function hasInitialObservation(fields: FullGameObservedFields): boolean {
  return fields.wCurMap !== undefined && fields.wYCoord !== undefined && fields.wXCoord !== undefined && fields.wPartyCount !== undefined;
}

function withCheckpoint(checkpoints: FullGameCheckpoints, checkpoint: FullGameCheckpointName): FullGameCheckpoints {
  return { ...checkpoints, [checkpoint]: true };
}

function countBits(value: number): number {
  let remaining = value;
  let count = 0;
  while (remaining > 0) {
    count += remaining & 1;
    remaining >>= 1;
  }
  return count;
}

export class FullGameDetector implements ProgressDetector<FullGameObservableState, FullGameStatus> {
  private checkpoints: FullGameCheckpoints = EMPTY_CHECKPOINTS;
  private status: HarnessStatus = "running";
  private step = 0;
  private lastProgressStep = 0;
  private starterObservationStreak = 0;
  private hallOfFameObservationStreak = 0;
  private lastBattleFlag: number | undefined;
  private readonly checkpointEvidence: FullGameCheckpointEvidence[] = [];
  private lastObserved: FullGameObservedFields | undefined;

  update(state: FullGameObservableState, action?: HarnessAction, frame?: number): FullGameStatus {
    if (this.status !== "running") {
      return this.getStatus();
    }

    this.step += 1;
    const observed = observedFieldsFrom(state);
    const advanced: FullGameCheckpointName[] = [];
    this.lastObserved = observed;
    this.starterObservationStreak = observed.wPartyCount !== undefined && observed.wPartyCount >= 1
      ? this.starterObservationStreak + 1
      : 0;
    this.hallOfFameObservationStreak = observed.hallOfFameComplete === true
      ? this.hallOfFameObservationStreak + 1
      : 0;

    const advance = (checkpoint: FullGameCheckpointName): void => {
      this.checkpoints = withCheckpoint(this.checkpoints, checkpoint);
      advanced.push(checkpoint);
      this.checkpointEvidence.push({ checkpoint, step: this.step, frame, action, observed });
    };

    if (!this.checkpoints.initialObserved && hasInitialObservation(observed)) {
      advance("initialObserved");
    }
    if (this.checkpoints.initialObserved && !this.checkpoints.starterAcquired && this.starterObservationStreak >= 2) {
      advance("starterAcquired");
    }
    if (this.checkpoints.starterAcquired && !this.checkpoints.rivalBattleEntered && this.lastBattleFlag === 0 && observed.wIsInBattle !== undefined && observed.wIsInBattle !== 0) {
      advance("rivalBattleEntered");
    }
    if (this.checkpoints.rivalBattleEntered && !this.checkpoints.rivalBattleExited && this.lastBattleFlag !== undefined && this.lastBattleFlag !== 0 && observed.wIsInBattle === 0) {
      advance("rivalBattleExited");
    }
    if (!this.checkpoints.badgesObserved && observed.wObtainedBadges !== undefined) {
      advance("badgesObserved");
    }
    if (this.checkpoints.badgesObserved && !this.checkpoints.allBadgesObtained && observed.badgeCount === 8) {
      advance("allBadgesObtained");
    }
    if (!this.checkpoints.hallOfFameObserved && this.hallOfFameObservationStreak >= 1) {
      advance("hallOfFameObserved");
    }
    if (!this.checkpoints.hallOfFameCompleted && this.hallOfFameObservationStreak >= 2) {
      advance("hallOfFameCompleted");
    }
    if (this.checkpoints.hallOfFameCompleted && !this.checkpoints.completed) {
      advance("completed");
    }

    this.lastBattleFlag = observed.wIsInBattle;
    if (advanced.length > 0) {
      this.lastProgressStep = this.step;
    }
    if (this.checkpoints.completed) {
      this.status = "completed";
    }

    return this.getStatus();
  }

  getStatus(): FullGameStatus {
    return {
      status: this.status,
      checkpoints: this.checkpoints,
      progressStep: this.step,
      lastProgressStep: this.lastProgressStep,
      checkpointEvidence: [...this.checkpointEvidence],
      lastObserved: this.lastObserved
    };
  }
}
