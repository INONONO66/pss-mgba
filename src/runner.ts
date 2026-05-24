import type { AgentEvent, AgentRun } from "@minpeter/pss-runtime";
import type { MgbaHttpClient } from "./mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
  type MgbaObservation,
  type ObservedAgentInput,
} from "./observation";
import type { StuckMemorySnapshot } from "./stuck-memory";
import {
  createSupervisorEvent,
  type SupervisorIntervention,
  type SupervisorInterventionEvent,
  waitThroughBlackFrames,
} from "./supervisor";

export type RunnerEvent = AgentEvent | SupervisorInterventionEvent;

export const POKEMON_OBJECTIVE_PROMPT = [
  "Continue playing the already-loaded Pokémon game autonomously from the current emulator state.",
  "Your long-term objective is to beat the game from the current emulator state without resetting, reloading, or restarting progress.",
  "The runner injects the latest screenshot/status as input at the start of each turn.",
  "Injected screenshots include red movement guide lines marking 16x16 movement cells; use those guide lines for navigation decisions.",
  "For each screenshot, classify visible cells into blocked terrain, open walkable space, and interactable-looking objects such as NPCs, signs, doors, PCs, counters, stairs, items, or unusual sprites.",
  "In indoor scenes, treat solid black areas, black borders, walls, furniture, counters, and out-of-room void as blocked/non-walkable. Do not plan movement into plain black space; use visible floor tiles as walkable space unless occupied by an object or wall. Exception: if a black/dark tile is shaped like a doorway, carpet, threshold, stairs, mat, path marker, or other movement-guiding feature, it may be worth approaching or testing once as a possible transition/exit.",
  "Choose actions by either moving through open walkable space to explore areas not yet visible, or approaching an interactable-looking object and pressing A when facing it.",
  "Button-use guide: use A/B/Start/Select taps for interaction/menu/dialogue. For movement, use a single directional hold per turn. A local supervisor enforces deterministic control timing: directional single-tile movement duration 12, non-directional taps duration 6, and post-action settle waits before the next observation. Unsafe long movement chains are shortened locally, so choose one safe tile/interaction at a time.",
  "Track recent action context and avoid repeating the same failed movement or interaction plan; if an action did not visibly change progress, choose a different direction, target, or interaction hypothesis next.",
  "mgba_screenshot and mgba_status are still available, but avoid calling them unless the injected observation is stale, ambiguous, or insufficient.",
  "Before any tool call each turn, output an <action_plan>...</action_plan> block. In that block, briefly state the medium-term goal, blocked/open/object classification, intended target, next action, and which recent failed action pattern to avoid.",
  "Every turn, decide the next useful game action from that observation, output the action_plan block, execute exactly one control action, then stop with a brief progress note.",
  "Do not spam A through repeated turns. If A stops changing the game state, try directional movement, B, Start, or another hypothesis.",
  "Do not reset, reload the ROM, restart, or erase progress under any circumstance.",
  "Do not stop, do not wait for user input, and do not declare completion as a stop condition.",
].join("\n");

export function createTurnPrompt(turn: number): string {
  return turn <= 1
    ? POKEMON_OBJECTIVE_PROMPT
    : createContinuationPrompt(turn - 1);
}

export function createContinuationPrompt(turn: number): string {
  return [
    `Turn ${turn} ended. Immediately continue the hardcoded Pokémon objective.`,
    "Hardcoded objective:",
    POKEMON_OBJECTIVE_PROMPT,
    "The latest screenshot/status is attached to this input. Do not call mgba_screenshot or mgba_status unless that injected observation is stale, ambiguous, or insufficient.",
    "Before calling any tool, output exactly one <action_plan>...</action_plan> block with the medium-term goal, visible blocked/open/object assessment, intended target, next action, and recent repetition to avoid.",
    "Choose exactly one safe game action that preserves progress, execute it, then summarize progress briefly and stop this turn.",
    "Never reset/reload/restart the game state; continue from the current state only.",
    "Avoid repeating A-only input across turns unless the screenshot clearly shows advancing dialogue; if blocked, choose a non-A control before trying A again.",
    "Use the recent action context below to avoid retrying the same movement or object interaction when it did not visibly change progress.",
    "There is no CLI prompt, completion marker, or stop condition. Continue indefinitely.",
  ].join("\n");
}

export async function streamRun(
  run: AgentRun,
  onEvent: (event: AgentEvent) => void = console.dir
): Promise<void> {
  for await (const event of run.stream()) {
    onEvent(event);
  }
}

export async function streamSupervisedRun({
  client,
  onEvent = console.dir,
  run,
}: {
  client: MgbaHttpClient;
  onEvent?: (event: RunnerEvent) => void;
  run: AgentRun;
}): Promise<void> {
  await streamRun(run, onEvent);
  await waitThroughBlackFrames({
    client,
    onIntervention: (intervention) =>
      onEvent(createSupervisorEvent(intervention)),
  });
}

export function createSupervisorInterventionEvent(
  intervention: SupervisorIntervention
): SupervisorInterventionEvent {
  return createSupervisorEvent(intervention);
}

export async function createObservedTurnInput({
  client,
  onObservation,
  recentActions,
  stuckMemory,
  turn,
}: {
  client: MgbaHttpClient;
  onObservation?: (observation: MgbaObservation) => void;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  turn: number;
}): Promise<ObservedAgentInput> {
  const observation = await captureMgbaObservation(client);
  onObservation?.(observation);
  return createObservedInput({
    observation,
    recentActions,
    stuckMemory,
    text: createTurnPrompt(turn),
  });
}

export async function createObservedContinuationInput({
  client,
  onObservation,
  recentActions,
  stuckMemory,
  turn,
}: {
  client: MgbaHttpClient;
  onObservation?: (observation: MgbaObservation) => void;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  turn: number;
}): Promise<ObservedAgentInput> {
  return await createObservedTurnInput({
    client,
    onObservation,
    recentActions,
    stuckMemory,
    turn: turn + 1,
  });
}
