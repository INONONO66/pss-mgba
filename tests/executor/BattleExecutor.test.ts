import { describe, expect, it } from "vitest";
import { executeBattle } from "../../src/executor/BattleExecutor.js";
import type { FullGameState, MoveSlot, PartyPokemon } from "../../src/pokemon/PokemonTypes.js";

function createMockController() {
  return {
    pressed: [] as { button: string; frames: number }[],
    async pressButton(button: string, frames = 5) {
      this.pressed.push({ button, frames });
    },
  };
}

function createBattleState(moves: string[], partyNicknames: string[]): FullGameState {
  const moveSlots = moves.map((name, index): MoveSlot => ({
    id: index + 1,
    name,
    pp: 10,
    ppUp: 0,
    maxPp: 10,
  }));

  const members = partyNicknames.map((nickname, index): PartyPokemon => ({
    slot: index,
    speciesId: index + 1,
    species: nickname,
    nickname,
    level: 5,
    hp: 20,
    maxHp: 20,
    status: "OK",
    types: ["Normal", "Normal"],
    moves: index === 0 ? moveSlots : [{ id: 99, name: "Tackle", pp: 35, ppUp: 0, maxPp: 35 }],
    stats: { attack: 10, defense: 10, speed: 10, special: 10 },
    experience: 0,
  }));

  return {
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
    party: { count: members.length, members },
    bag: [{ id: 1, name: "Potion", quantity: 3 }],
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
}

describe("BattleExecutor", () => {
  it('fight("Ember") with Ember at slot 1 presses FIGHT, Down once, then A', async () => {
    const controller = createMockController();
    const fullState = createBattleState(["Scratch", "Ember"], ["Charmander"]);

    const result = await executeBattle(
      { type: "battle", action: { kind: "fight", move: "Ember" } },
      controller,
      fullState,
    );

    expect(controller.pressed).toEqual([
      { button: "Up", frames: 5 },
      { button: "Left", frames: 5 },
      { button: "A", frames: 15 },
      { button: "Down", frames: 5 },
      { button: "A", frames: 15 },
    ]);
    expect(result).toEqual({ status: "success", reason: "move_used", details: "Used Ember" });
  });

  it('fight("Scratch") at slot 0 presses FIGHT, then A without move navigation', async () => {
    const controller = createMockController();
    const fullState = createBattleState(["Scratch", "Ember"], ["Charmander"]);

    const result = await executeBattle(
      { type: "battle", action: { kind: "fight", move: "Scratch" } },
      controller,
      fullState,
    );

    expect(controller.pressed).toEqual([
      { button: "Up", frames: 5 },
      { button: "Left", frames: 5 },
      { button: "A", frames: 15 },
      { button: "A", frames: 15 },
    ]);
    expect(result).toEqual({ status: "success", reason: "move_used", details: "Used Scratch" });
  });

  it('item("Potion") presses ITEM menu, then A', async () => {
    const controller = createMockController();
    const fullState = createBattleState(["Scratch"], ["Charmander"]);

    const result = await executeBattle(
      { type: "battle", action: { kind: "item", item: "Potion" } },
      controller,
      fullState,
    );

    expect(controller.pressed).toEqual([
      { button: "Up", frames: 5 },
      { button: "Right", frames: 5 },
      { button: "A", frames: 15 },
      { button: "A", frames: 15 },
    ]);
    expect(result).toEqual({ status: "success", reason: "item_used", details: "Used Potion" });
  });

  it('switch("Pikachu") at party slot 2 presses POKEMON, Down twice, then A', async () => {
    const controller = createMockController();
    const fullState = createBattleState(["Scratch"], ["Charmander", "Bulbasaur", "Pikachu"]);

    const result = await executeBattle(
      { type: "battle", action: { kind: "switch", pokemon: "Pikachu" } },
      controller,
      fullState,
    );

    expect(controller.pressed).toEqual([
      { button: "Down", frames: 5 },
      { button: "Left", frames: 5 },
      { button: "A", frames: 15 },
      { button: "Down", frames: 5 },
      { button: "Down", frames: 5 },
      { button: "A", frames: 15 },
    ]);
    expect(result).toEqual({ status: "success", reason: "pokemon_switched", details: "Switched to Pikachu" });
  });

  it("run presses RUN menu, then A", async () => {
    const controller = createMockController();
    const fullState = createBattleState(["Scratch"], ["Charmander"]);

    const result = await executeBattle(
      { type: "battle", action: { kind: "run" } },
      controller,
      fullState,
    );

    expect(controller.pressed).toEqual([
      { button: "Down", frames: 5 },
      { button: "Right", frames: 5 },
      { button: "A", frames: 15 },
    ]);
    expect(result).toEqual({ status: "success", reason: "fled", details: "Attempted to flee" });
  });

  it("returns descriptive status and details for battle actions", async () => {
    const fullState = createBattleState(["Scratch", "Ember"], ["Charmander", "Pikachu"]);

    await expect(executeBattle({ type: "battle", action: { kind: "fight", move: "Ember" } }, createMockController(), fullState))
      .resolves.toMatchObject({ status: "success", details: "Used Ember" });
    await expect(executeBattle({ type: "battle", action: { kind: "item", item: "Potion" } }, createMockController(), fullState))
      .resolves.toMatchObject({ status: "success", details: "Used Potion" });
    await expect(executeBattle({ type: "battle", action: { kind: "switch", pokemon: "Pikachu" } }, createMockController(), fullState))
      .resolves.toMatchObject({ status: "success", details: "Switched to Pikachu" });
    await expect(executeBattle({ type: "battle", action: { kind: "run" } }, createMockController(), fullState))
      .resolves.toMatchObject({ status: "success", details: "Attempted to flee" });
  });
});
