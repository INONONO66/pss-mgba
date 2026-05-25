import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "../../src/ai/PromptBuilder.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";

const gameKnowledgeLines = [
  "World Rules",
  "Progression Model",
  "NPC Rules",
  "Stuck Patterns",
  "Output Rules"
];

describe("PromptBuilder", () => {
  it("buildSystemPrompt for overworld contains overworld commands only", () => {
    const prompt = buildSystemPrompt("overworld");

    expect(prompt).toContain("navigate(x, y)");
    expect(prompt).not.toContain("battle(action)");
  });

  it("buildSystemPrompt for battle contains battle commands only", () => {
    const prompt = buildSystemPrompt("battle");

    expect(prompt).toContain("fight(move)");
    expect(prompt).not.toContain("navigate(x, y)");
  });

  it("buildSystemPrompt for dialog contains dialog commands only", () => {
    const prompt = buildSystemPrompt("dialog");

    expect(prompt).toContain("choose(index)");
    expect(prompt).not.toContain("navigate(x, y)");
  });

  it("all system prompts contain game knowledge instead of legacy identity", () => {
    for (const mode of ["overworld", "battle", "dialog"] as const) {
      const prompt = buildSystemPrompt(mode);
      for (const line of gameKnowledgeLines) {
        expect(prompt).toContain(line);
      }
      expect(prompt).not.toContain("You are a Pokemon Red/Blue game controller AI");
    }
  });

  it("buildUserMessage with overworld state includes map graph and current map", () => {
    const message = buildUserMessage({
      mode: "overworld",
      step: 12,
      fullState: fullState(),
      mapGraph: "* Route 1 (map 12) — you are here\n  → south: Pallet Town",
      currentMapFull: "Route 1\n22 ..@..",
      microContext: {
        position: { x: 15, y: 22 },
        facing: "down",
        adjacent: { up: "open", down: "unknown" }
      }
    });

    expect(message).toContain("[STATE: OVERWORLD]");
    expect(message).toContain("Location: Route 1 (map 12), pos (15,22), facing down");
    expect(message).toContain("[MAP GRAPH]");
    expect(message).toContain("* Route 1 (map 12) — you are here");
    expect(message).toContain("[CURRENT MAP]");
    expect(message).toContain("Position: (15,22), facing down");
  });

  it("buildUserMessage with battle state includes moves with PP", () => {
    const message = buildUserMessage({
      mode: "battle",
      fullState: fullState({ battle: true })
    });

    expect(message).toContain("[STATE: BATTLE]");
    expect(message).toContain("Type: wild");
    expect(message).toContain("Enemy: Rattata Lv3 (Normal) HP 12/12");
    expect(message).toContain("- Scratch (Normal, PP 0/35) ← EMPTY");
    expect(message).toContain("- Ember (Fire, PP 25/25)");
    expect(message).toContain("Can run: yes");
  });

  it("buildUserMessage with dialog state includes choices", () => {
    const message = buildUserMessage({
      mode: "dialog",
      fullState: fullState({ dialogText: "Would you like to nickname it?" }),
      state: { choices: ["YES", "NO"] }
    });

    expect(message).toContain("[STATE: DIALOG]");
    expect(message).toContain("Screen text: \"Would you like to nickname it?\"");
    expect(message).toContain("Choices: [YES, NO]");
  });

  it("buildUserMessage includes history section with formatted entries", () => {
    const message = buildUserMessage({
      mode: "overworld",
      commandHistory: [
        {
          step: 1,
          command: { type: "navigate", x: 5, y: 3 },
          result: { status: "success", reason: "arrived", details: "4 tiles" }
        },
        {
          step: 2,
          command: { type: "interact", direction: "up" },
          result: { status: "interrupted", reason: "dialog started" }
        },
        {
          step: 3,
          command: { type: "battle", action: { kind: "fight", move: "Ember" } },
          result: { status: "success", reason: "enemy fainted" }
        }
      ]
    });

    expect(message).toContain("[HISTORY]");
    expect(message).toContain("[1] navigate(5,3) → success: arrived (4 tiles)");
    expect(message).toContain("[2] interact(up) → interrupted: dialog started");
    expect(message).toContain("[3] battle(fight:\"Ember\") → success: enemy fainted");
  });

  it("buildUserMessage includes last result when present", () => {
    const message = buildUserMessage({
      mode: "overworld",
      commandHistory: [{ step: 4, command: { type: "navigate", x: 4, y: 0 }, result: { status: "partial", reason: "reached edge" } }],
      lastResult: { status: "partial", reason: "reached edge", details: "unexplored ahead" }
    });

    expect(message).toContain("[LAST RESULT]");
    expect(message).toContain("navigate(4,0) → partial: reached edge (unexplored ahead)");
  });

  it("buildUserMessage handles empty optional fields gracefully", () => {
    const message = buildUserMessage({ mode: "overworld" });

    expect(message).toContain("[PROGRESS]");
    expect(message).toContain("[STATE: OVERWORLD]");
    expect(message).toContain("Location: Unknown (map ?), pos (?,?), facing unknown");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("[HISTORY]");
    expect(message).not.toContain("[LAST RESULT]");
  });
});

function fullState(options: { battle?: boolean; dialogText?: string } = {}): FullGameState {
  return {
    player: {
      name: "RED",
      rivalName: "BLUE",
      money: 3000,
      position: { mapId: 12, y: 22, x: 15, yBlock: 1, xBlock: 1 },
      facing: { raw: 0, direction: "down" },
      badges: { raw: 1, count: 1, obtained: [true], names: ["Boulder"] },
      playTime: "1:23"
    },
    map: { mapId: 12, mapName: "Route 1", tilesetId: 0, width: 10, height: 36 },
    party: {
      count: 2,
      members: [
        {
          slot: 0,
          speciesId: 4,
          species: "Charmander",
          nickname: "Charmander",
          level: 7,
          hp: 22,
          maxHp: 24,
          status: "OK",
          types: ["Fire", "Fire"],
          moves: [
            { id: 1, name: "Scratch", pp: 0, ppUp: 0, maxPp: 35, type: "Normal" },
            { id: 2, name: "Ember", pp: 25, ppUp: 0, maxPp: 25, type: "Fire" }
          ],
          stats: { attack: 12, defense: 10, speed: 13, special: 11 },
          experience: 120
        },
        {
          slot: 1,
          speciesId: 16,
          species: "Pidgey",
          nickname: "Pidgey",
          level: 4,
          hp: 15,
          maxHp: 18,
          status: "OK",
          types: ["Normal", "Flying"],
          moves: [{ id: 3, name: "Gust", pp: 35, ppUp: 0, maxPp: 35, type: "Flying" }],
          stats: { attack: 8, defense: 7, speed: 9, special: 6 },
          experience: 30
        }
      ]
    },
    bag: [{ id: 20, name: "Potion", quantity: 3 }],
    battle: {
      inBattle: options.battle === true,
      type: options.battle === true ? "wild" : "none",
      enemy: options.battle === true ? {
        speciesId: 19,
        species: "Rattata",
        level: 3,
        hp: 12,
        maxHp: 12,
        status: "OK",
        types: ["Normal", "Normal"],
        moves: [{ id: 4, name: "Tackle", pp: 35, ppUp: 0, maxPp: 35, type: "Normal" }]
      } : undefined
    },
    dialog: { active: options.dialogText !== undefined, textBoxId: 1, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 1, count: 1, obtained: [true], names: ["Boulder"] }
    },
    menuText: {
      currentMenuItem: 0,
      textBoxId: 1,
      letterPrintingDelayFlags: 0,
      screenText: options.dialogText ?? "",
      screenTextKind: options.dialogText === undefined ? "none" : "overworld_text",
      namingScreenNameLength: 0,
      namingScreenSubmitName: 0,
      namingScreenType: 0
    }
  } as unknown as FullGameState;
}
