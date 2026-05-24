import { describe, expect, it } from "vitest";
import { buildStateSummary } from "../../src/pokemon/StateSummary.js";
import type { FullGameState } from "../../src/pokemon/PokemonTypes.js";

describe("buildStateSummary", () => {
  it("derives adjacent tiles from rendered map rows without treating headers or row gutters as tiles", () => {
    const summary = buildStateSummary(stateAt(1, 1), [
      "   012",
      " 0 ###",
      " 1 #@.",
      " 2 #\"N",
      "",
      "  Legend: .=walkable #=wall \"=grass ?=unknown @=player N=NPC"
    ].join("\n"));

    expect(summary).toContain("Adjacent tiles: Up:blocked, Down:open, Left:blocked, Right:open");
  });
  it("does not report every direction blocked when the player is outside current map memory", () => {
    const summary = buildStateSummary(stateAt(9, 4), [
      "   01234",
      " 0 ?????",
      " 1 ?????",
      " 2 ?????",
      " 3 ?????",
      " 4 ?????",
      " 5 .....",
      "",
      "  Legend: .=walkable #=wall grass ?=unknown @=player N=NPC"
    ].join("\n"));

    expect(summary).toContain("Adjacent tiles: unknown (player position is outside current map-memory bounds)");
    expect(summary).not.toContain("Adjacent tiles: Up:blocked, Down:blocked, Left:blocked, Right:blocked");
  });

  it("reports unknown rather than blocked for unseen adjacent map cells", () => {
    const summary = buildStateSummary(stateAt(1, 1), [
      "   012",
      " 0 ???",
      " 1 ?@.",
      " 2 ?#N"
    ].join("\n"));

    expect(summary).toContain("Adjacent tiles: Up:unknown, Down:blocked, Left:unknown, Right:open");
  });

  it("uses explicit max PP when formatting damaged moves", () => {
    const damagedMoveState: FullGameState = {
      ...stateAt(1, 1),
      party: {
        count: 1,
        members: [{
          slot: 0,
          speciesId: 1,
          species: "Bulbasaur",
          nickname: "BULBY",
          level: 5,
          hp: 10,
          maxHp: 20,
          status: "OK",
          types: ["Grass", "Poison"],
          moves: [{ id: 0x21, name: "Tackle", pp: 12, ppUp: 1, maxPp: 56 }],
          stats: { attack: 1, defense: 1, speed: 1, special: 1 },
          experience: 0
        }]
      }
    };

    expect(buildStateSummary(damagedMoveState)).toContain("Tackle (PP 12/56)");
  });

  it("does not fabricate a max PP denominator when live readers have not supplied one", () => {
    const liveReaderMoveState: FullGameState = {
      ...stateAt(1, 1),
      party: {
        count: 1,
        members: [{
          slot: 0,
          speciesId: 1,
          species: "Bulbasaur",
          nickname: "BULBY",
          level: 5,
          hp: 10,
          maxHp: 20,
          status: "OK",
          types: ["Grass", "Poison"],
          moves: [{ id: 0x21, name: "Tackle", pp: 12, ppUp: 1 }],
          stats: { attack: 1, defense: 1, speed: 1, special: 1 },
          experience: 0
        }]
      }
    };

    expect(buildStateSummary(liveReaderMoveState)).toContain("Tackle (PP 12)");
    expect(buildStateSummary(liveReaderMoveState)).not.toContain("Tackle (PP 12/12)");
  });

});

function stateAt(y: number, x: number): FullGameState {
  return {
    player: {
      name: "RED",
      rivalName: "BLUE",
      money: 3000,
      position: { mapId: 0, y, x, yBlock: 0, xBlock: 0 },
      facing: { raw: 0, direction: "down" },
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] },
      playTime: "0:00:00.00"
    },
    map: { mapId: 0, mapName: "Pallet Town", tilesetId: 0, width: 3, height: 3 },
    party: { count: 0, members: [] },
    bag: [],
    battle: { inBattle: false, type: "none" },
    dialog: { active: false, textBoxId: 0, letterPrintingDelayFlags: 0, joyIgnore: 0 },
    flags: {
      hasPokedex: false,
      hasOaksParcel: false,
      deliveredOaksParcel: false,
      pokedexOwned: 0,
      pokedexSeen: 0,
      badges: { raw: 0, count: 0, obtained: [false, false, false, false, false, false, false, false], names: [] }
    },
    menuText: {
      currentMenuItem: 0,
      textBoxId: 0,
      letterPrintingDelayFlags: 0,
      screenText: "",
      screenTextKind: "none",
      namingScreenNameLength: 0,
      namingScreenSubmitName: 0,
      namingScreenType: 0
    }
  };
}
