import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { FullGameState } from "../../src/game/PokemonTypes.js";
import { LLMAdviser, type LLMAdviserConfig, type LLMAdviserInput } from "../../src/supervisor/index.js";

type GenerateTextFn = NonNullable<LLMAdviserConfig["generateTextFn"]>;

describe("LLMAdviser", () => {
  it("returns advice on hard stuck", async () => {
    const mockGenerateText = mockAdviceGenerator("Go to Oak's Lab and talk to Professor Oak.");
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    const result = await adviser.advise(input(), 1);

    expect(result).toEqual({
      advice: "Go to Oak's Lab and talk to Professor Oak.",
      situationKey: "map:38:badges:0:stuck:Same action repeated 5 times",
    });
  });

  it("respects cooldown", async () => {
    const mockGenerateText = mockAdviceGenerator("Go downstairs.");
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    await adviser.advise(input(), 1);
    const result = await adviser.advise(input(), 3);

    expect(result).toBeUndefined();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("allows advise after cooldown expires", async () => {
    const mockGenerateText = mockAdviceGenerator("Go downstairs.");
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    await adviser.advise(input(), 1);
    const result = await adviser.advise(input(), 10);

    expect(result?.advice).toBe("Go downstairs.");
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("canAdvise returns false during cooldown", async () => {
    const adviser = new LLMAdviser(configWith(mockAdviceGenerator("Go downstairs.")));

    await adviser.advise(input(), 1);

    expect(adviser.canAdvise(3)).toBe(false);
  });

  it("canAdvise returns true after cooldown", async () => {
    const adviser = new LLMAdviser(configWith(mockAdviceGenerator("Go downstairs.")));

    await adviser.advise(input(), 1);

    expect(adviser.canAdvise(10)).toBe(true);
  });

  it("generates deterministic situationKey", async () => {
    const first = new LLMAdviser(configWith(mockAdviceGenerator("Go downstairs.")));
    const second = new LLMAdviser(configWith(mockAdviceGenerator("Talk to Mom.")));

    const firstResult = await first.advise(input(), 1);
    const secondResult = await second.advise(input(), 1);

    expect(firstResult?.situationKey).toBe(secondResult?.situationKey);
  });

  it("returns undefined on generateText error", async () => {
    const mockGenerateText = vi.fn(() => Promise.reject(new Error("LLM unavailable")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    const result = await adviser.advise(input(), 1);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("LLMAdviser failed to generate advice", expect.any(Error));
    warn.mockRestore();
  });

  it("passes correct system and user prompts", async () => {
    const mockGenerateText = mockAdviceGenerator("Go downstairs.");
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    await adviser.advise(input({ currentGoal: "Leave the bedroom" }), 1);

    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      maxTokens: 200,
      model: mockModel,
      system: expect.stringContaining("You are a Pokemon Red/Blue walkthrough expert"),
      prompt: expect.stringContaining("Current state:\n- Map: Reds House 2f (id 38)"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("- Party: Charmander Lv5 (18/20 HP)"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("- Bag: Potion x1"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Story flags: Pokedex=false, Oak's Parcel=false, Delivered=false"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Maps visited: Reds House 2f (id 38), map 1"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Current goal: Leave the bedroom"),
    }));
  });

  it("includes walkthrough context in prompt when provided", async () => {
    const mockGenerateText = mockAdviceGenerator("Go to the Poke Mart.");
    const adviser = new LLMAdviser(configWith(mockGenerateText));

    await adviser.advise(input({ walkthroughContext: "Head inside the Poke Mart to collect Oak's Parcel." }), 1);

    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Reference walkthrough for this area:"),
    }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Head inside the Poke Mart to collect Oak's Parcel."),
    }));
  });
});

const mockModel = {} as LanguageModel;

function mockAdviceGenerator(text: string): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({ text }));
}

function configWith(generateTextFn: ReturnType<typeof vi.fn>): LLMAdviserConfig {
  return {
    model: mockModel,
    cooldownTurns: 5,
    maxTokens: 200,
    generateTextFn: generateTextFn as GenerateTextFn,
  };
}

function input(overrides: Partial<LLMAdviserInput> = {}): LLMAdviserInput {
  return {
    fullState: fullState(),
    stuckReasons: ["Same action repeated 5 times"],
    visitedMapIds: [38, 1],
    recentHistory: "A, A, A, A, A",
    currentGoal: "unknown",
    ...overrides,
  };
}

function fullState(overrides: Partial<FullGameState> = {}): FullGameState {
  return {
    player: {
      name: "RED",
      rivalName: "BLUE",
      money: 3000,
      position: { mapId: 38, y: 3, x: 3, yBlock: 1, xBlock: 1 },
      facing: { raw: 8, direction: "left" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "1:38:18.22",
    },
    map: { mapId: 38, mapName: "Reds House 2f", tilesetId: 4, width: 4, height: 4 },
    party: {
      count: 1,
      members: [{
        slot: 0,
        speciesId: 4,
        species: "Charmander",
        nickname: "CHAR",
        level: 5,
        hp: 18,
        maxHp: 20,
        status: "OK",
        types: ["Fire", "Fire"],
        moves: [{ id: 33, name: "Tackle", pp: 35, ppUp: 0 }],
        stats: { attack: 11, defense: 10, speed: 12, special: 11 },
        experience: 135,
      }]
    },
    bag: [{ id: 20, name: "Potion", quantity: 1 }],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 0, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
    },
    menuText: {
      currentMenuItem: 0,
      textBoxId: 0,
      letterPrintingDelayFlags: 0,
      screenText: "",
      screenTextKind: "none",
      namingScreenNameLength: 0,
      namingScreenSubmitName: 0,
      namingScreenType: 0,
    },
    ...overrides,
  };
}
