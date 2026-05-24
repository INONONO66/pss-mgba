import type { MgbaStatus } from "./mgba-http";
import type { PokemonStateObservation } from "./pokemon-state";

export const POKEMON_MILESTONES = [
  "title-menu-handled",
  "new-game-started-or-resumed",
  "player-control-reached",
  "first-map-transition",
  "first-dialogue-completed",
  "first-battle-detected",
  "first-battle-completed",
  "first-pokemon-obtained",
] as const;

export type PokemonMilestoneId = (typeof POKEMON_MILESTONES)[number];

export interface PokemonMilestoneSnapshot {
  current: PokemonMilestoneId | null;
  furthest: PokemonMilestoneId | null;
}

export interface PokemonMilestoneObservation {
  state?: PokemonStateObservation;
  status?: Pick<MgbaStatus, "gameCode" | "gameTitle">;
}

const milestoneRanks = new Map<PokemonMilestoneId, number>(
  POKEMON_MILESTONES.map((milestone, index) => [milestone, index])
);

export class PokemonMilestoneTracker {
  #furthest: PokemonMilestoneId | null = null;
  #previousState: PokemonStateObservation | undefined;

  observe(observation: PokemonMilestoneObservation): PokemonMilestoneSnapshot {
    const scored = scorePokemonMilestone(observation, this.#previousState);
    const state = observation.state;
    if (state) {
      this.#previousState = state;
    }
    if (scored && isAfter(scored, this.#furthest)) {
      this.#furthest = scored;
    }
    return this.snapshot();
  }

  snapshot(): PokemonMilestoneSnapshot {
    return {
      current: this.#furthest,
      furthest: this.#furthest,
    };
  }
}

export function scorePokemonMilestone(
  observation: PokemonMilestoneObservation,
  previousState?: PokemonStateObservation
): PokemonMilestoneId | null {
  const state = observation.state;
  if (!state || state.readStatus !== "available") {
    return null;
  }

  if (
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return null;
  }

  if (state.battle) {
    return "first-battle-detected";
  }

  if (previousState?.battle && !state.battle) {
    return "first-battle-completed";
  }

  if (previousState?.dialogueLike === true && state.dialogueLike !== true) {
    return "first-dialogue-completed";
  }

  if (
    previousState?.readStatus === "available" &&
    previousState.mapId !== null &&
    previousState.mapId !== state.mapId
  ) {
    return "first-map-transition";
  }

  if (isPlayerControlState(state)) {
    return "player-control-reached";
  }

  if (state.menuLike === true) {
    return "title-menu-handled";
  }

  return "new-game-started-or-resumed";
}

function isPlayerControlState(state: PokemonStateObservation): boolean {
  return (
    !state.battle &&
    state.dialogueLike !== true &&
    state.menuLike !== true &&
    state.direction !== "unknown"
  );
}

function isAfter(
  candidate: PokemonMilestoneId,
  current: PokemonMilestoneId | null
): boolean {
  if (!current) {
    return true;
  }
  return rank(candidate) > rank(current);
}

function rank(milestone: PokemonMilestoneId): number {
  return milestoneRanks.get(milestone) ?? -1;
}
