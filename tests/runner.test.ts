import type { AgentEvent, AgentRun } from "@minpeter/pss-runtime";
import { describe, expect, it } from "vitest";
import {
  createContinuationPrompt,
  POKEMON_OBJECTIVE_PROMPT,
  streamRun,
} from "../src/runner";

class FakeRun implements AgentRun {
  readonly #events: AgentEvent[];

  constructor(events: AgentEvent[]) {
    this.#events = events;
  }

  stream(): AsyncIterable<AgentEvent> {
    const events = this.#events;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        let index = 0;
        return {
          next: () =>
            Promise.resolve(
              index < events.length
                ? { done: false, value: events[index++] }
                : { done: true, value: undefined }
            ),
        };
      },
    };
  }
}

describe("POKEMON_OBJECTIVE_PROMPT", () => {
  it("hardcodes the autonomous Pokémon objective", () => {
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Load the configured ROM");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("beat the game");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Do not spam A");
    expect(POKEMON_OBJECTIVE_PROMPT).toContain("Do not stop");
  });
});

describe("createContinuationPrompt", () => {
  it("keeps the hardcoded objective and removes stop conditions", () => {
    const prompt = createContinuationPrompt(7);

    expect(prompt).toContain("Turn 7 ended");
    expect(prompt).toContain("Hardcoded objective:");
    expect(prompt).toContain(POKEMON_OBJECTIVE_PROMPT);
    expect(prompt).toContain("Avoid repeating A-only input");
    expect(prompt).toContain("There is no CLI prompt");
    expect(prompt).toContain("or stop condition");
  });
});

describe("streamRun", () => {
  it("forwards all events", async () => {
    const events: AgentEvent[] = [
      { type: "turn-start" },
      { type: "assistant-text", text: "first" },
      { type: "assistant-text", text: "done" },
      { type: "turn-end" },
    ];
    const forwarded: AgentEvent[] = [];

    await streamRun(new FakeRun(events), (event) => {
      forwarded.push(event);
    });

    expect(forwarded).toEqual(events);
  });
});
