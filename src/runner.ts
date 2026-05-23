import type { AgentEvent, AgentInput, AgentRun } from "@minpeter/pss-runtime";
import type { MgbaHttpClient } from "./mgba-http";
import { captureMgbaObservation, createObservedInput } from "./observation";

export const POKEMON_OBJECTIVE_PROMPT = [
  "Load the configured ROM and play Pokémon autonomously.",
  "Your long-term objective is to beat the game from the current emulator state.",
  "The runner injects the latest screenshot/status as input at the start of each turn.",
  "Every turn, decide the next useful game action from that observation, execute exactly one control action, then stop with a brief progress note.",
  "Do not spam A through repeated turns. If A stops changing the game state, try directional movement, B, Start, or another hypothesis.",
  "Do not stop, do not wait for user input, and do not declare completion as a stop condition.",
].join("\n");

export function createContinuationPrompt(turn: number): string {
  return [
    `Turn ${turn} ended. Immediately continue the hardcoded Pokémon objective.`,
    "Hardcoded objective:",
    POKEMON_OBJECTIVE_PROMPT,
    "The latest screenshot/status is attached to this input. Do not ask for observation tools.",
    "Choose exactly one safe game action, execute it, then summarize progress briefly and stop this turn.",
    "Avoid repeating A-only input across turns unless the screenshot clearly shows advancing dialogue; if blocked, choose a non-A control before trying A again.",
    "There is no CLI prompt, turn budget, completion marker, or stop condition. Continue indefinitely.",
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

export async function createObservedContinuationInput({
  client,
  turn,
}: {
  client: MgbaHttpClient;
  turn: number;
}): Promise<AgentInput> {
  const observation = await captureMgbaObservation(client);
  return createObservedInput({
    observation,
    text: createContinuationPrompt(turn),
  });
}
