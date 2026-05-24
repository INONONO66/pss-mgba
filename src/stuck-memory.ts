import { createHash } from "node:crypto";
import type { AgentEvent } from "@minpeter/pss-runtime";
import type { MgbaObservation } from "./observation";
import type {
  PokemonDirection,
  PokemonStateObservation,
} from "./pokemon-state";

const MOVEMENT_BUTTONS = new Set(["Down", "Left", "Right", "Up"]);
const STUCK_THRESHOLD = 8;
const MAX_FAILED_EDGES = 6;
const MAX_RECOVERY_ATTEMPTS = 6;

export interface FailedMovementEdge {
  action: string;
  attempts: number;
  context: string;
  lastSeenTurn: number;
}

export interface RecoveryAttempt {
  action: string;
  context: string;
  turn: number;
}

export interface StuckMemorySnapshot {
  failedMovementEdges: readonly FailedMovementEdge[];
  recentRecoveryAttempts: readonly RecoveryAttempt[];
  stuckEvents: number;
}

interface PendingMovementAttempt {
  action: string;
  context: MovementContext;
  turn: number;
}

interface MovementContext {
  key: string;
  label: string;
  mapId?: number;
  position?: {
    x: number;
    y: number;
  };
  screenshotHash?: string;
  stateBased: boolean;
}

export class StuckMemory {
  readonly #failedMovementEdges = new Map<string, FailedMovementEdge>();
  readonly #recentRecoveryAttempts: RecoveryAttempt[] = [];
  #lastFailedKey: string | undefined;
  #pendingMovementAttempt: PendingMovementAttempt | undefined;
  #repeatedFailedMovementAttempts = 0;
  #stuckEvents = 0;

  observe(observation: MgbaObservation, turn: number): void {
    const pending = this.#pendingMovementAttempt;
    this.#pendingMovementAttempt = undefined;
    if (!pending) {
      return;
    }

    const currentContext = movementContextFromObservation(observation);
    if (!(currentContext && isStationary(pending.context, currentContext))) {
      this.#lastFailedKey = undefined;
      this.#repeatedFailedMovementAttempts = 0;
      return;
    }

    const failedKey = `${pending.context.key}|${pending.action}`;
    if (this.#lastFailedKey === failedKey) {
      this.#repeatedFailedMovementAttempts += 1;
    } else {
      this.#lastFailedKey = failedKey;
      this.#repeatedFailedMovementAttempts = 1;
    }

    const attempts = this.#repeatedFailedMovementAttempts;
    if (attempts === STUCK_THRESHOLD) {
      this.#stuckEvents += 1;
    }

    this.#recordFailedEdge({
      action: pending.action,
      attempts,
      context: pending.context.label,
      lastSeenTurn: turn,
    });
  }

  recordEvent(
    event: AgentEvent,
    observation: MgbaObservation,
    turn: number
  ): void {
    if (event.type !== "tool-call") {
      return;
    }

    const action = movementActionFromToolCall(event.toolName, event.input);
    if (!action) {
      this.#recordRecoveryAttempt(event, observation, turn);
      return;
    }

    const context = movementContextFromObservation(observation);
    if (!context) {
      this.#pendingMovementAttempt = undefined;
      return;
    }

    this.#pendingMovementAttempt = {
      action,
      context,
      turn,
    };
  }

  snapshot(): StuckMemorySnapshot {
    return {
      failedMovementEdges: [...this.#failedMovementEdges.values()],
      recentRecoveryAttempts: [...this.#recentRecoveryAttempts],
      stuckEvents: this.#stuckEvents,
    };
  }

  #recordFailedEdge(edge: FailedMovementEdge): void {
    const key = `${edge.context}|${edge.action}`;
    this.#failedMovementEdges.delete(key);
    this.#failedMovementEdges.set(key, edge);
    while (this.#failedMovementEdges.size > MAX_FAILED_EDGES) {
      const oldestKey = this.#failedMovementEdges.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.#failedMovementEdges.delete(oldestKey);
    }
  }

  #recordRecoveryAttempt(
    event: Extract<AgentEvent, { type: "tool-call" }>,
    observation: MgbaObservation,
    turn: number
  ): void {
    if (!this.#lastFailedKey) {
      return;
    }

    const context = movementContextFromObservation(observation);
    if (!context) {
      return;
    }

    this.#recentRecoveryAttempts.push({
      action: `${event.toolName.replace("mgba_", "")}: ${JSON.stringify(event.input)}`,
      context: context.label,
      turn,
    });
    this.#recentRecoveryAttempts.splice(
      0,
      Math.max(0, this.#recentRecoveryAttempts.length - MAX_RECOVERY_ATTEMPTS)
    );
  }
}

export function formatStuckMemory(
  memory: StuckMemorySnapshot | undefined
): string {
  if (!memory || memory.failedMovementEdges.length === 0) {
    return "";
  }

  const failedEdges = memory.failedMovementEdges
    .slice(-MAX_FAILED_EDGES)
    .map(
      (edge) =>
        `- ${edge.context}; ${edge.action}; failed ${edge.attempts}x; last turn ${edge.lastSeenTurn}`
    );
  const recoveryAttempts = memory.recentRecoveryAttempts
    .slice(-MAX_RECOVERY_ATTEMPTS)
    .map(
      (attempt) =>
        `- turn ${attempt.turn}: ${attempt.action} after ${attempt.context}`
    );

  return [
    "",
    "failed movement memory:",
    ...failedEdges,
    ...(recoveryAttempts.length > 0
      ? ["recent recovery attempts:", ...recoveryAttempts]
      : []),
  ].join("\n");
}

function movementContextFromObservation(
  observation: MgbaObservation
): MovementContext | undefined {
  const stateContext = movementContextFromState(observation.state);
  if (stateContext) {
    return stateContext;
  }

  if (observation.state) {
    return;
  }

  const screenshotHash = createHash("sha256")
    .update(observation.screenshot.data)
    .digest("hex")
    .slice(0, 12);
  return {
    key: `screen:${screenshotHash}`,
    label: `screen=${screenshotHash}`,
    screenshotHash,
    stateBased: false,
  };
}

function movementContextFromState(
  state: PokemonStateObservation | undefined
): MovementContext | undefined {
  if (!state || state.readStatus !== "available") {
    return;
  }
  if (state.battle || state.dialogueLike === true || state.menuLike === true) {
    return;
  }
  if (
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }

  const direction = formatDirectionForContext(state.direction);
  const key = `map:${state.mapId}:x:${state.position.x}:y:${state.position.y}:dir:${direction}`;
  return {
    key,
    label: `map=${state.mapId} x=${state.position.x} y=${state.position.y} facing=${direction}`,
    mapId: state.mapId,
    position: {
      x: state.position.x,
      y: state.position.y,
    },
    stateBased: true,
  };
}

function isStationary(
  before: MovementContext,
  after: MovementContext
): boolean {
  if (before.stateBased || after.stateBased) {
    return before.key === after.key;
  }
  return before.screenshotHash === after.screenshotHash;
}

function movementActionFromToolCall(
  toolName: string,
  input: unknown
): string | undefined {
  if (!["mgba_hold", "mgba_tap"].includes(toolName)) {
    return;
  }

  const buttons = extractButtons(input).filter((button) =>
    MOVEMENT_BUTTONS.has(button)
  );
  if (buttons.length !== 1) {
    return;
  }

  return `${toolName.replace("mgba_", "")}:${buttons[0]}`;
}

function extractButtons(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as { button?: unknown; buttons?: unknown };
  if (typeof record.button === "string") {
    return [record.button];
  }
  if (Array.isArray(record.buttons)) {
    return record.buttons.filter(
      (button): button is string => typeof button === "string"
    );
  }
  return [];
}

function formatDirectionForContext(direction: PokemonDirection): string {
  return direction === "unknown" ? "unknown" : direction;
}
