import type { HarnessAction } from "../control/ActionTypes.js";
import type { HarnessStatus } from "../shared/types.js";
import type { DetectorStatus, ProgressDetector } from "./Detector.js";
import { HALL_OF_FAME_MAP_ID as MEMORY_MAP_HALL_OF_FAME_MAP_ID } from "./memoryMap.js";
import type { FullGameState } from "./PokemonTypes.js";
export const HALL_OF_FAME_MAP_ID = MEMORY_MAP_HALL_OF_FAME_MAP_ID;

type FullGameCheckpointName =
  | "initialObserved"
  | "starterAcquired"
  | "rivalBattleEntered"
  | "rivalBattleExited"
  | "badgesObserved"
  | "allBadgesObtained"
  | "hallOfFameObserved"
  | "hallOfFameCompleted"
  | "completed";

export interface FullGameObservableState {
  readonly wCurMap?: number;
  readonly mapId?: number;
  readonly wYCoord?: number;
  readonly y?: number;
  readonly wXCoord?: number;
  readonly x?: number;
  readonly wPartyCount?: number;
  readonly partyCount?: number;
  readonly wIsInBattle?: number;
  readonly isInBattle?: boolean | number;
  readonly wObtainedBadges?: number;
  readonly badgeCount?: number;
  readonly badgesObtained?: readonly boolean[];
  readonly hallOfFameComplete?: boolean;
}

interface FullGameObservedFields {
  readonly wCurMap?: number;
  readonly wYCoord?: number;
  readonly wXCoord?: number;
  readonly wPartyCount?: number;
  readonly wIsInBattle?: number;
  readonly wObtainedBadges?: number;
  readonly badgeCount?: number;
  readonly hallOfFameComplete?: boolean;
}

interface FullGameCheckpoints {
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

interface FullGameCheckpointEvidence {
  readonly checkpoint: FullGameCheckpointName;
  readonly step: number;
  readonly frame?: number;
  readonly action?: HarnessAction;
  readonly observed: FullGameObservedFields;
}

interface FullGameStatus extends DetectorStatus<FullGameCheckpoints> {
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
}

function badgeCountFrom(state: FullGameObservableState): number | undefined {
  if (typeof state.badgeCount === "number") {
    return state.badgeCount;
  }
  if (state.badgesObtained !== undefined) {
    return state.badgesObtained.filter(Boolean).length;
  }
  if (typeof state.wObtainedBadges === "number") {
    return countBits(state.wObtainedBadges);
  }
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

export function toObservableState(state: FullGameState): FullGameObservableState {
  const battleTypeToFlag = (type: FullGameState["battle"]["type"]): number => {
    switch (type) {
      case "wild":
        return 1;
      case "trainer":
        return 2;
      case "none":
      case "lost":
        return 0;
      default:
        return 0;
    }
  };

  return {
    wCurMap: state.player.position.mapId,
    mapId: state.player.position.mapId,
    wYCoord: state.player.position.y,
    y: state.player.position.y,
    wXCoord: state.player.position.x,
    x: state.player.position.x,
    wPartyCount: state.party.count,
    partyCount: state.party.count,
    wIsInBattle: battleTypeToFlag(state.battle.type),
    isInBattle: state.battle.inBattle,
    wObtainedBadges: state.flags.badges.raw,
    badgeCount: state.flags.badges.count,
    badgesObtained: state.flags.badges.obtained,
    hallOfFameComplete: state.map.mapId === HALL_OF_FAME_MAP_ID
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
    count += remaining % 2;
    remaining = Math.floor(remaining / 2);
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

  private advanceCheckpoint(
    checkpoint: FullGameCheckpointName,
    action: HarnessAction | undefined,
    frame: number | undefined,
    observed: FullGameObservedFields,
    advanced: FullGameCheckpointName[]
  ): void {
    this.checkpoints = withCheckpoint(this.checkpoints, checkpoint);
    advanced.push(checkpoint);
    this.checkpointEvidence.push({ checkpoint, step: this.step, frame, action, observed });
  }

  private updateStoryProgress(
    observed: FullGameObservedFields,
    action: HarnessAction | undefined,
    frame: number | undefined,
    advanced: FullGameCheckpointName[]
  ): void {
    if (!this.checkpoints.initialObserved && hasInitialObservation(observed)) {
      this.advanceCheckpoint("initialObserved", action, frame, observed, advanced);
    }
    if (this.checkpoints.initialObserved && !this.checkpoints.starterAcquired && this.starterObservationStreak >= 2) {
      this.advanceCheckpoint("starterAcquired", action, frame, observed, advanced);
    }
    if (this.checkpoints.starterAcquired && !this.checkpoints.rivalBattleEntered && this.lastBattleFlag === 0 && observed.wIsInBattle !== undefined && observed.wIsInBattle !== 0) {
      this.advanceCheckpoint("rivalBattleEntered", action, frame, observed, advanced);
    }
    if (this.checkpoints.rivalBattleEntered && !this.checkpoints.rivalBattleExited && this.lastBattleFlag !== undefined && this.lastBattleFlag !== 0 && observed.wIsInBattle === 0) {
      this.advanceCheckpoint("rivalBattleExited", action, frame, observed, advanced);
    }
  }

  private updateBadgeProgress(
    observed: FullGameObservedFields,
    action: HarnessAction | undefined,
    frame: number | undefined,
    advanced: FullGameCheckpointName[]
  ): void {
    if (!this.checkpoints.badgesObserved && observed.wObtainedBadges !== undefined) {
      this.advanceCheckpoint("badgesObserved", action, frame, observed, advanced);
    }
    if (this.checkpoints.badgesObserved && !this.checkpoints.allBadgesObtained && observed.badgeCount === 8) {
      this.advanceCheckpoint("allBadgesObtained", action, frame, observed, advanced);
    }
  }

  private updateHallOfFameProgress(
    observed: FullGameObservedFields,
    action: HarnessAction | undefined,
    frame: number | undefined,
    advanced: FullGameCheckpointName[]
  ): void {
    if (!this.checkpoints.hallOfFameObserved && this.hallOfFameObservationStreak >= 1) {
      this.advanceCheckpoint("hallOfFameObserved", action, frame, observed, advanced);
    }
    if (!this.checkpoints.hallOfFameCompleted && this.hallOfFameObservationStreak >= 2) {
      this.advanceCheckpoint("hallOfFameCompleted", action, frame, observed, advanced);
    }
    if (this.checkpoints.hallOfFameCompleted && !this.checkpoints.completed) {
      this.advanceCheckpoint("completed", action, frame, observed, advanced);
    }
  }

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

    this.updateStoryProgress(observed, action, frame, advanced);
    this.updateBadgeProgress(observed, action, frame, advanced);
    this.updateHallOfFameProgress(observed, action, frame, advanced);

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
