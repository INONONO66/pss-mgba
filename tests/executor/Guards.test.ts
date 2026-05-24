import { describe, expect, it } from "vitest";
import type { Command, CommandResult } from "../../src/control/CommandTypes.js";
import { validateCommand, type GuardContext } from "../../src/executor/Guards.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";

function makeState(overrides: Partial<FullGameState> = {}): FullGameState {
  const base: FullGameState = {
    player: {
      name: "Red",
      rivalName: "Blue",
      money: 3000,
      position: { mapId: 1, y: 5, x: 5, yBlock: 0, xBlock: 0 },
      facing: { raw: 0, direction: "down" },
      badges: { raw: 0, count: 0, obtained: [], names: [] },
      playTime: "00:00",
    },
    map: { mapId: 1, mapName: "Test Map", tilesetId: 0, width: 10, height: 10 },
    party: {
      count: 3,
      members: [
        {
          slot: 0,
          speciesId: 1,
          species: "Bulbasaur",
          nickname: "Leafy",
          level: 5,
          hp: 20,
          maxHp: 20,
          status: "OK",
          types: ["Grass", "Poison"],
          moves: [
            { id: 1, name: "Scratch", pp: 0, ppUp: 0, maxPp: 35 },
            { id: 2, name: "Ember", pp: 25, ppUp: 0, maxPp: 25 },
            { id: 3, name: "Growl", pp: 38, ppUp: 0, maxPp: 40 },
          ],
          stats: { attack: 10, defense: 10, speed: 10, special: 10 },
          experience: 0,
        },
        {
          slot: 1,
          speciesId: 4,
          species: "Charmander",
          nickname: "Ember",
          level: 5,
          hp: 0,
          maxHp: 18,
          status: "OK",
          types: ["Fire", "Fire"],
          moves: [{ id: 4, name: "Tackle", pp: 35, ppUp: 0, maxPp: 35 }],
          stats: { attack: 10, defense: 10, speed: 10, special: 10 },
          experience: 0,
        },
        {
          slot: 2,
          speciesId: 7,
          species: "Squirtle",
          nickname: "Shell",
          level: 5,
          hp: 19,
          maxHp: 19,
          status: "OK",
          types: ["Water", "Water"],
          moves: [{ id: 5, name: "Water Gun", pp: 25, ppUp: 0, maxPp: 25 }],
          stats: { attack: 10, defense: 10, speed: 10, special: 10 },
          experience: 0,
        },
      ],
    },
    bag: [
      { id: 1, name: "Potion", quantity: 3 },
      { id: 2, name: "Pokeball", quantity: 5 },
    ],
    battle: { inBattle: true, type: "wild" },
    dialog: { active: false, textBoxId: 0, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [], names: [] },
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
  };

  return {
    ...base,
    ...overrides,
    player: overrides.player ?? base.player,
    map: overrides.map ?? base.map,
    party: overrides.party ?? base.party,
    bag: overrides.bag ?? base.bag,
    battle: overrides.battle ?? base.battle,
    dialog: overrides.dialog ?? base.dialog,
    flags: overrides.flags ?? base.flags,
    menuText: overrides.menuText ?? base.menuText,
  };
}

function context(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    fullState: makeState(overrides.fullState),
    mapWidth: overrides.mapWidth ?? 10,
    mapHeight: overrides.mapHeight ?? 10,
  };
}

function resultOf(command: Command, ctx = context()): CommandResult | undefined {
  const result = validateCommand(command, ctx);
  return result.valid ? undefined : result.result;
}

describe("Guards", () => {
  it("1. fight with valid move + PP → valid", () => {
    expect(validateCommand({ type: "battle", action: { kind: "fight", move: "emBer" } }, context())).toEqual({ valid: true });
  });

  it("2. fight with PP=0 → rejected: no_pp + hint with available moves", () => {
    const result = resultOf({ type: "battle", action: { kind: "fight", move: "scratch" } });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("no_pp");
    expect(result?.details).toContain("Scratch has 0 PP");
    expect(result?.details).toContain("Available moves with PP:");
    expect(result?.details).toContain("Ember (PP 25/25)");
  });

  it("3. fight with unknown move → rejected: move_not_found + hint", () => {
    const result = resultOf({ type: "battle", action: { kind: "fight", move: "Thunderbolt" } });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("move_not_found");
    expect(result?.details).toBe("Move 'Thunderbolt' not found. Available: Scratch, Ember, Growl");
  });

  it("4. item in bag → valid", () => {
    expect(validateCommand({ type: "battle", action: { kind: "item", item: "pOtIoN" } }, context())).toEqual({ valid: true });
  });

  it("5. item not in bag → rejected: item_not_in_bag + hint", () => {
    const result = resultOf({ type: "battle", action: { kind: "item", item: "Antidote" } });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("item_not_in_bag");
    expect(result?.details).toBe("Antidote not in bag. Bag: Potion x3, Pokeball x5");
  });

  it("6. switch to valid pokemon → valid", () => {
    expect(validateCommand({ type: "battle", action: { kind: "switch", pokemon: "sHeLl" } }, context())).toEqual({ valid: true });
  });

  it("7. switch to fainted pokemon → rejected", () => {
    const result = resultOf({ type: "battle", action: { kind: "switch", pokemon: "ember" } });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("pokemon_fainted");
  });

  it("8. switch to active pokemon → rejected: already_active", () => {
    const result = resultOf({ type: "battle", action: { kind: "switch", pokemon: "Leafy" } });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("already_active");
  });

  it("9. run in wild battle → valid", () => {
    expect(validateCommand({ type: "battle", action: { kind: "run" } }, context())).toEqual({ valid: true });
  });

  it("10. run in trainer battle → rejected: cannot_run_trainer", () => {
    const result = resultOf({ type: "battle", action: { kind: "run" } }, context({ fullState: makeState({ battle: { inBattle: true, type: "trainer" } }) }));
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("cannot_run_trainer");
  });

  it("11. navigate in bounds → valid", () => {
    expect(validateCommand({ type: "navigate", x: 9, y: 9 }, context())).toEqual({ valid: true });
  });

  it("12. navigate out of bounds → rejected: invalid_target", () => {
    const result = resultOf({ type: "navigate", x: 10, y: 0 });
    expect(result?.status).toBe("rejected");
    expect(result?.reason).toBe("invalid_target");
  });

  it("13. interact/dialog/wait/raw → always valid", () => {
    const commands: Command[] = [
      { type: "interact" },
      { type: "dialog", action: { kind: "advance" } },
      { type: "wait", frames: 1 },
      { type: "raw", inputs: [], reason: "fallback" },
    ];

    for (const command of commands) {
      expect(validateCommand(command, context())).toEqual({ valid: true });
    }
  });
});
